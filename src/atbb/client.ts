import { readFile } from 'node:fs/promises';
import { chromium, type Browser, type Frame, type Page } from 'playwright';
import { requireBrowserAtbbConfig, type AppConfig } from '../config.js';
import type { CustomerSearchCondition, PropertyListing } from '../types.js';
import { maskUrl } from '../log.js';

// ---------------------------------------------------------------------------
// インターフェース
// ---------------------------------------------------------------------------

export interface AtbbClient {
  /** セッション開始（ログイン）。close() と対になる */
  start(): Promise<void>;
  /** 保存条件一覧を取得する */
  fetchSavedConditions(): Promise<AtbbSavedCondition[]>;
  /** 指定条件の物件一覧を取得する */
  fetchListings(condition: CustomerSearchCondition): Promise<PropertyListing[]>;
  /** インフォシートURLのスクリーンショットをJPEGバッファで返す（未対応/失敗時はnull） */
  screenshotInfoSheet(infoSheetUrl: string): Promise<Buffer | null>;
  /** セッション終了（ブラウザを閉じる） */
  close(): Promise<void>;
}

export interface AtbbSavedCondition {
  /** ATBB上の条件名（例: "Kotomi_池袋_家賃13万_"） */
  name: string;
  /** ATBB上の条件ID（atbbBukkenKensakuJokenNumber） */
  conditionId: string;
}

// ---------------------------------------------------------------------------
// FixtureAtbbClient: JSON ファイルから物件を読み込む（テスト用）
// ---------------------------------------------------------------------------

export class FixtureAtbbClient implements AtbbClient {
  constructor(private readonly fixturePath: string) {}

  async start(): Promise<void> { /* no-op */ }
  async close(): Promise<void> { /* no-op */ }

  async fetchSavedConditions(): Promise<AtbbSavedCondition[]> {
    return [];
  }

  async fetchListings(): Promise<PropertyListing[]> {
    const content = await readFile(this.fixturePath, 'utf8');
    return JSON.parse(content) as PropertyListing[];
  }

  async screenshotInfoSheet(_infoSheetUrl: string): Promise<Buffer | null> {
    return null;
  }
}

// ---------------------------------------------------------------------------
// BrowserAtbbClient: Playwright で ATBB を操作する（本番用）
// ---------------------------------------------------------------------------

export class BrowserAtbbClient implements AtbbClient {
  private browser: Browser | null = null;
  private atbbPage: Page | null = null;
  private atbbOrigin: string = '';

  constructor(private readonly config: AppConfig) {}

  /** ブラウザを起動してATBBにログインする */
  async start(): Promise<void> {
    requireBrowserAtbbConfig(this.config);
    const headless = process.env['ATBB_HEADLESS'] !== 'false';
    this.browser = await chromium.launch({ headless });
    const loginPage = await this.browser.newPage();
    this.atbbPage = await loginAndNavigateToAtbb(loginPage, this.config);
    this.atbbOrigin = new URL(this.atbbPage.url()).origin;
    // ATBB業務システム(atbb.athome.co.jp)に到達できているか検証する。
    // ポータル(members.athome.jp 等)に留まると後続の業務ページが応答せず
    // タイムアウトするため、ここで失敗させて呼び出し元(withRetry)で
    // ブラウザごとやり直させる。
    if (!ATBB_BUSINESS_HOST.test(this.atbbOrigin)) {
      throw new Error(`ATBB業務システムのホストに到達できませんでした (現在: ${this.atbbOrigin})`);
    }
  }

  /** ブラウザを閉じる */
  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.atbbPage = null;
    this.atbbOrigin = '';
  }

  /** ATBBの保存条件一覧を取得する */
  async fetchSavedConditions(): Promise<AtbbSavedCondition[]> {
    const page = await this.getPage();
    await page.goto(`${this.atbbOrigin}/front-web/mainservlet/bfcm003s208`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => { /* ok */ });
    await page.waitForTimeout(2000);
    // 表示件数を100件に変更してページ数を最小化する
    const countSelect = page.locator('select[name="pngDisplayCount"]').first();
    if (await countSelect.count() > 0) {
      const currentVal = await countSelect.inputValue().catch(() => '');
      if (currentVal !== '100') {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
          countSelect.selectOption('100'),
        ]);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { /* ok */ });
        await page.waitForTimeout(2000);
      }
    }
    return scrapeSavedConditionsAllPages(page);
  }

  /** 指定条件の前回閲覧日以降の物件一覧を取得する */
  async fetchListings(condition: CustomerSearchCondition): Promise<PropertyListing[]> {
    const ownSession = !this.browser;
    if (ownSession) await this.start();
    try {
      const page = this.atbbPage!;
      await page.goto(`${this.atbbOrigin}/front-web/mainservlet/bfcm003s208`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => { /* ok */ });
      await page.waitForTimeout(2000);
      const found = await clickConditionLink(page, condition.atbbSavedConditionId ?? null);
      if (!found) {
        console.log(`  [ATBB] 条件 conditionId=${condition.atbbSavedConditionId ?? condition.id} は指定日以降0件のためスキップ`);
        return [];
      }
      await page.waitForLoadState('domcontentloaded');
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { /* ok */ });
      return await parseAllPages(page);
    } finally {
      if (ownSession) await this.close();
    }
  }

  /**
   * インフォシートページの物件図面部分（.top-block）と下部ブロック（.btm-block）を
   * まとめて切り出して JPEG Buffer で返す。
   * 会員間情報を非表示にしているため、下部ブロックには自社名が表示される。
   * プレビュー枠（赤枠）・編集アイコンは除外する。
   * URL が無効またはエラーが発生した場合は null を返す。
   */
  async screenshotInfoSheet(infoSheetUrl: string): Promise<Buffer | null> {
    if (!this.browser) return null;
    const absoluteUrl = infoSheetUrl.startsWith('http')
      ? infoSheetUrl
      : `${this.atbbOrigin}${infoSheetUrl.startsWith('/') ? '' : '/'}${infoSheetUrl}`;

    // deviceScaleFactor を 2 にして高解像度（2倍）で描画し、
    // 小さい文字がぼやけないようにする。
    const page = await this.browser.newPage({
      viewport: { width: 1280, height: 1400 },
      deviceScaleFactor: 2,
    });
    try {
      await page.goto(absoluteUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { /* ok */ });

      // 物件図面ブロックの描画を待つ
      const topBlock = page.locator('.top-block').first();
      await topBlock.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { /* ok */ });
      await page.waitForTimeout(2000);

      // プレビュー枠（赤枠）・編集アイコン・プレビュー表記を非表示にして
      // 物件情報だけのきれいな図面にする
      await page.addStyleTag({
        content: `
          .top-block { border: none !important; box-shadow: none !important; }
          #preview-mark, #edit-btn,
          .image-remove-icon, .image-arrenge-icon,
          [id^="image-resize-icon"], [class*="-icon"] {
            display: none !important;
            visibility: hidden !important;
          }
        `,
      }).catch(() => { /* ok */ });
      await page.waitForTimeout(300);

      // 建物名（.top-block .sub）が画像から消えないようにする。
      // 「会員間情報」を非表示にすると、その副作用でインフォシート上の建物名まで
      // 隠れる（visibility:hidden / display:none 化、またはテキストが空になる）ため、
      // ここで強制的に再表示する。テキストが失われている場合は「建物名」欄や
      // 埋め込みデータ（tatemono_nm / heya_no）から復元する。
      // ただし物件側が建物名の非公開を指定（kaiin_muke_tatemono_hihyoji_fl=true）して
      // いる場合はその意思を尊重し、何もしない。
      await page.evaluate(`
        (() => {
          function clean(s) { return (s || '').replace(/\\s+/g, ' ').trim(); }
          function blankish(s) { return clean(s).replace(/[\\-/／－]/g, '').trim() === ''; }

          var sub = document.querySelector('.top-block .sub');
          if (!sub) return;

          // 副作用で隠れている可能性があるので強制的に可視化する
          sub.style.setProperty('visibility', 'visible', 'important');
          sub.style.setProperty('display', 'block', 'important');
          var inner = sub.querySelectorAll('*');
          for (var n = 0; n < inner.length; n++) {
            inner[n].style.setProperty('visibility', 'visible', 'important');
          }

          // 既に建物名のテキストが残っていれば、可視化だけで十分
          if (!blankish(sub.textContent)) return;

          // テキストが消えている → 復元元を探す
          var name = '';
          // ① 表組みの「建物名」欄
          var labels = document.querySelectorAll('.top-block th, .top-block td');
          for (var i = 0; i < labels.length; i++) {
            if (clean(labels[i].textContent) === '建物名') {
              var td = labels[i].nextElementSibling;
              if (td && !blankish(td.textContent)) { name = clean(td.textContent); break; }
            }
          }
          // ② 埋め込みデータ（tatemono_nm / heya_no）
          if (blankish(name)) {
            var html = document.documentElement.innerHTML;
            if (/"kaiin_?muke_?tatemono_?hihyoji_?fl"\\s*:\\s*true/i.test(html)) return; // 非公開希望は尊重
            var nm = (html.match(/"tatemono_?nm"\\s*:\\s*"([^"]*)"/i) || [])[1] || '';
            var heya = (html.match(/"heya_?no"\\s*:\\s*"([^"]*)"/i) || [])[1] || '';
            name = clean(nm + ' ' + heya);
          }
          if (blankish(name)) return;

          // 元の位置（.sub）に自然な形で建物名を表示する
          var span = document.createElement('span');
          span.textContent = name;
          sub.innerHTML = '';
          var p = document.createElement('p');
          p.style.setProperty('visibility', 'visible', 'important');
          p.style.setProperty('display', 'block', 'important');
          p.appendChild(span);
          sub.appendChild(p);
        })()
      `).catch(() => { /* ok */ });
      await page.waitForTimeout(200);

      // 物件図面がビューポート外に出てクリップで欠けないよう、
      // ページ全体の高さに合わせてビューポートを広げる。
      const docHeight = await page.evaluate(
        `Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)`
      ).catch(() => 1400) as number;
      await page.setViewportSize({ width: 1280, height: Math.min(Math.max(docHeight, 1400), 4000) });
      await page.waitForTimeout(300);

      // 物件図面（.top-block）のみを切り出す。
      // 下部ブロック（.btm-block）はLINE送信には不要なため含めない。
      const clip = await page.evaluate(`
        (() => {
          const top = document.querySelector('.top-block');
          if (!top) return null;
          const r = top.getBoundingClientRect();
          return {
            x: Math.max(0, r.left),
            y: Math.max(0, r.top),
            width: r.width,
            height: r.height,
          };
        })()
      `) as { x: number; y: number; width: number; height: number } | null;

      let buffer: Buffer;
      if (clip && clip.width > 0 && clip.height > 0) {
        buffer = Buffer.from(await page.screenshot({ type: 'jpeg', quality: 92, clip }));
      } else {
        // フォールバック: ページ全体
        buffer = Buffer.from(await page.screenshot({ fullPage: true, type: 'jpeg', quality: 92 }));
      }
      return buffer;
    } catch (err) {
      console.warn(`  [ATBB] インフォシートのスクリーンショット取得失敗 (${maskUrl(absoluteUrl)}): ${err}`);
      return null;
    } finally {
      await page.close();
    }
  }

  private async getPage(): Promise<Page> {
    if (!this.atbbPage) throw new Error('start() を先に呼び出してください');
    return this.atbbPage;
  }
}

// ---------------------------------------------------------------------------
// ATBBログインとポータル→ATBBナビゲーション
// ---------------------------------------------------------------------------

/** ATBB業務システムのホスト（ポータル members.athome.jp 等と区別する） */
const ATBB_BUSINESS_HOST = /atbb\.athome\.co\.jp/;

async function loginAndNavigateToAtbb(page: Page, config: AppConfig): Promise<Page> {
  await page.goto('https://atbb.athome.jp/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator("input[name='loginId']").fill(config.ATBB_USERNAME);
  await page.locator("input[name='password']").fill(config.ATBB_PASSWORD);
  await page.locator("input[id='loginSubmit']").click();
  await page.waitForURL((url) => !url.href.includes('login'), { timeout: 30000 }).catch(() => { /* ok */ });
  await page.waitForTimeout(2000);

  const atbbPage = await openAtbbHome(page);

  if (atbbPage.url().includes('ConcurrentLogin') || atbbPage.url().includes('concurrent')) {
    await atbbPage.goto(new URL('/front-web/login/force', atbbPage.url()).href, { waitUntil: 'domcontentloaded' });
    await atbbPage.waitForTimeout(2000);
  }

  return atbbPage;
}

/**
 * 「ATBBホームへ」をクリックして ATBB 業務システム（atbb.athome.co.jp）へ遷移する。
 * 新タブで開く場合・同一タブで遷移する場合の両方に対応し、
 * SSO ハンドオフの遅延（特に CI の遅いランナー）を考慮して
 * 業務ホストに到達するまで最大3回クリックを試みる。
 */
async function openAtbbHome(portalPage: Page): Promise<Page> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const [newPage] = await Promise.all([
      // 新タブが開くまで十分待つ（5秒だと CI で間に合わずポータルに留まることがある）
      portalPage.context().waitForEvent('page', { timeout: 20000 }).catch(() => null),
      portalPage.locator('text=ATBBホームへ').first().click().catch(() => null),
    ]);
    const candidate: Page = newPage ?? portalPage;
    await candidate.waitForLoadState('domcontentloaded').catch(() => { /* ok */ });
    // 業務ホストへの遷移を待つ（SSO リダイレクトが遅延することがある）
    await candidate.waitForURL(ATBB_BUSINESS_HOST, { timeout: 20000 }).catch(() => { /* ok */ });
    await candidate.waitForTimeout(1000);

    if (ATBB_BUSINESS_HOST.test(candidate.url())) {
      return candidate;
    }
    // 開いている全タブの中から業務ホストのタブを探す
    const atbbTab = portalPage.context().pages().find((p) => ATBB_BUSINESS_HOST.test(p.url()));
    if (atbbTab) return atbbTab;

    await portalPage.waitForTimeout(2000);
  }

  // フォールバック: 最後に開いたページを返す（呼び出し元の start() が
  // ホスト不一致を検出して withRetry でやり直す）
  const pages = portalPage.context().pages();
  return pages[pages.length - 1] ?? portalPage;
}

// ---------------------------------------------------------------------------
// 保存条件ページから条件名・conditionId を抽出（全ページ対応）
// ---------------------------------------------------------------------------

async function scrapeSavedConditionsAllPages(page: Page): Promise<AtbbSavedCondition[]> {
  const all: AtbbSavedCondition[] = [];
  while (true) {
    const conditions = await scrapeSavedConditions(page);
    all.push(...conditions);
    // 「次へ」リンクがあれば次ページへ
    const nextLink = page.locator('ul.pageing_menu a:has-text("次へ")').first();
    if (await nextLink.count() === 0) break;
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
      nextLink.click(),
    ]);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { /* ok */ });
    await page.waitForTimeout(2000);
  }
  return all;
}

async function scrapeSavedConditions(page: Page): Promise<AtbbSavedCondition[]> {
  return page.evaluate(() => {
    const datums = document.querySelectorAll<HTMLElement>('dl.kensakuJokenDatum');
    return [...datums].map((datum) => {
      const conditionId = datum.querySelector<HTMLInputElement>('.atbbBukkenKensakuJokenNumber')?.value ?? '';
      const name = datum.querySelector<HTMLElement>('.kensakuJokenTorokuMemo')?.textContent?.trim() ?? '';
      return { name, conditionId };
    }).filter((c) => c.conditionId !== '');
  }) as Promise<AtbbSavedCondition[]>;
}

// ---------------------------------------------------------------------------
// 保存条件ページから対象条件の件数リンクをクリック
// ---------------------------------------------------------------------------

/**
 * 対象条件の「前回閲覧日以降」件数リンクをクリックする。
 * 件数が 0 の場合は null を返す（呼び出し元でスキップ）。
 */
async function clickConditionLink(atbbPage: Page, conditionId: string | null): Promise<boolean> {
  // AJAX完了待ち（gaitoSuAfterShiteibi が現れたら件数ロード完了）
  await atbbPage.waitForSelector('.gaitoSuAfterShiteibi.number-big', { timeout: 30000 });

  let linkEl = atbbPage.locator('.gaitoSuAfterShiteibi.number-big a').first(); // フォールバック用

  if (conditionId) {
    const datum = atbbPage.locator(
      `dl.kensakuJokenDatum:has(input.atbbBukkenKensakuJokenNumber[value="${conditionId}"])`
    );
    if (await datum.count() > 0) {
      // スクロールして IntersectionObserver による遅延ロードをトリガーする
      await datum.scrollIntoViewIfNeeded().catch(() => { /* ok */ });

      // hidden input の value で件数を確認（初期値 "-" は読込中を意味する。0件でも <a> は存在するため count() では判定不可）
      const countInput = datum.locator('.gaitoSuAfterShiteibi.number-big input[type="hidden"]');
      // "-"（読込中）から実際の値へ更新されるまで最大15秒ポーリング
      let countVal = '-';
      const deadline = Date.now() + 15000;
      while (countVal === '-' && Date.now() < deadline) {
        countVal = await countInput.inputValue().catch(() => '-');
        if (countVal === '-') await atbbPage.waitForTimeout(500);
      }
      if (countVal === '-') {
        console.log(`  [ATBB] 条件 conditionId=${conditionId} の件数がタイムアウト内に読み込まれませんでした`);
      }
      const count = parseInt(countVal, 10);
      if (isNaN(count) || count <= 0) return false; // 0件 → スキップ
      linkEl = datum.locator('.gaitoSuAfterShiteibi.number-big a');
    }
  } else {
    // フォールバック: 全条件中で最初の0件超の条件を使う
    const countInput = atbbPage.locator('.gaitoSuAfterShiteibi.number-big input[type="hidden"]').first();
    const countVal = await countInput.inputValue().catch(() => '0');
    const count = parseInt(countVal, 10);
    if (isNaN(count) || count <= 0) return false;
  }

  // click() と waitForNavigation を並行実行して遷移を確実に待つ
  await Promise.all([
    atbbPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
    linkEl.click(),
  ]);
  // DEBUG: 遷移後URL確認
  console.log(`  [ATBB DEBUG] after click URL: ${atbbPage.url().split('?')[0]}, frames: ${atbbPage.frames().map(f => f.url().split('?')[0]).join(', ')}`);
  return true;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// bfcm241s004 の全ページを処理して PropertyListing[] を返す
// ---------------------------------------------------------------------------

/**
 * bfcm241s004 でエリア検索の場合は地図ビューが表示される。
 * 「一覧」ボタンをクリックして bfcm004s014 iframe をロードする。
 */
async function tryClickListViewButton(atbbPage: Page): Promise<boolean> {
  // ATBB の地図ページにある一覧切り替えボタン候補
  const selectors = [
    'a[onclick*="bfcm004s014"]',
    'input[onclick*="bfcm004s014"]',
    'a:has-text("一覧")',
    'input[value*="一覧"]',
    'a[href*="bfcm004s014"]',
  ];
  for (const sel of selectors) {
    const btn = atbbPage.locator(sel).first();
    if (await btn.count() > 0) {
      console.log(`  [ATBB] 一覧ボタンクリック (${sel})`);
      await btn.click();
      await atbbPage.waitForTimeout(3000);
      return true;
    }
  }
  return false;
}

/** 物件一覧フレームを返す。
 * 条件の検索区分によりページ構成が異なる:
 *   - 物件検索/地図: bfcm241s004 > bfcm004s014 > bfcm380s028 iframe
 *   - 物件検索/エリア: bfcm241s004 のメインフレームに物件一覧が直接表示（構造が異なる）
 */
async function waitForListFrame(atbbPage: Page, timeoutMs = 30000): Promise<Frame | null> {
  const deadline = Date.now() + timeoutMs;
  let listBtnClicked = false;

  while (Date.now() < deadline) {
    // URLベース: bfcm380s028（地図検索）
    const byUrl = atbbPage.frames().find(f => /bfcm380s028/.test(f.url()));
    if (byUrl) return byUrl;

    // コンテンツベース（地図検索用）: 全フレームで bukkenId 非空を探す
    for (const frame of atbbPage.frames()) {
      try {
        const count = await frame.evaluate(`
          (() => {
            const inputs = document.querySelectorAll('input[name="bukkenId"]');
            return [...inputs].filter(el => el.value && el.value.trim() !== '').length;
          })()
        `);
        if ((count as number) > 0) return frame;
      } catch { /* frame navigating */ }
    }

    // エリア検索: div.property_card が存在するフレームを返す
    for (const frame of atbbPage.frames()) {
      try {
        const cards = await frame.evaluate(`document.querySelectorAll('div.property_card').length`);
        if ((cards as number) > 0) return frame;
      } catch { /* frame navigating */ }
    }

    // エリア検索用: 「一覧」ボタンが存在すれば1回だけクリック（waitForNavigationなし）
    if (!listBtnClicked) {
      const listBtn = atbbPage.locator('input[value*="一覧"]').first();
      if (await listBtn.count() > 0) {
        console.log('  [ATBB] 一覧ボタンをクリック...');
        listBtnClicked = true;
        await listBtn.click();
        await atbbPage.waitForTimeout(500);
        continue;
      }
    }

    await atbbPage.waitForTimeout(500);
  }

  // タイムアウト: メインフレームのHTML全体をデバッグファイルに書き出す
  try {
    const { writeFile } = await import('node:fs/promises');
    const mainHtml = String(await atbbPage.evaluate(`document.documentElement.outerHTML`).catch(() => ''));
    await writeFile('debug-bfcm241s004-full.html', mainHtml, 'utf8');
    console.log('  [ATBB DEBUG] Full HTML written to debug-bfcm241s004-full.html');
  } catch { /* ok */ }

  console.log('  [ATBB DEBUG] frames at timeout:');
  for (const frame of atbbPage.frames()) {
    console.log(`    frame url: ${maskUrl(frame.url())}`);
  }

  return null;
}

/**
 * 物件一覧の「会員間情報」トグルを「非表示」に切り替える。
 * トグルは bfcm241s004 フレーム内にあり、ラジオ #toggle-show（表示, 初期 checked）と
 * #toggle-hidden（非表示）の2択。#toggle-hidden の onclick で
 * BFCM381S392SJohoHyojiHiHyojiClicked(true,'0') が走り、会員間情報が非表示になる。
 * 非表示にするとインフォシート下部ブロックに自社名が表示される。
 * 既に非表示の場合や要素が見つからない場合は何もしない。
 */
async function hideMemberInfo(listFrame: Frame): Promise<void> {
  const hiddenRadio = listFrame.locator('#toggle-hidden');
  if (await hiddenRadio.count() === 0) {
    console.warn('  [ATBB] 会員間情報トグル(#toggle-hidden)が見つかりませんでした');
    return;
  }

  // 既に非表示なら何もしない
  const alreadyHidden = await hiddenRadio.isChecked().catch(() => false);
  if (alreadyHidden) {
    console.log('  [ATBB] 会員間情報は既に「非表示」です');
    return;
  }

  // ラジオの onclick ハンドラを確実に発火させるため evaluate で click() する。
  // （トグルはラベルでオーバーレイされており、座標クリックが不安定なため）
  const clicked = await listFrame.evaluate(`
    (() => {
      var el = document.getElementById('toggle-hidden');
      if (!el) return false;
      el.click();
      return true;
    })()
  `).catch(() => false);

  if (!clicked) {
    console.warn('  [ATBB] 会員間情報の「非表示」切替に失敗しました');
    return;
  }

  // 切替後の再描画（AJAX）を待つ
  await listFrame.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { /* ok */ });
  await atbbPageWaitTimeout(listFrame, 1500);

  const nowHidden = await hiddenRadio.isChecked().catch(() => false);
  console.log(`  [ATBB] 会員間情報を「非表示」に切替: ${nowHidden ? '成功' : '未確定'}`);
}

/** Frame から所属ページの waitForTimeout を呼ぶヘルパー */
async function atbbPageWaitTimeout(frame: Frame, ms: number): Promise<void> {
  const page = frame.page();
  if (page) await page.waitForTimeout(ms).catch(() => { /* ok */ });
}

async function parseAllPages(atbbPage: Page): Promise<PropertyListing[]> {
  const listings: PropertyListing[] = [];

  const listFrame = await waitForListFrame(atbbPage);
  if (!listFrame) {
    console.warn('  [ATBB] 物件一覧フレームが見つかりませんでした');
    return [];
  }

  // 会員間情報を「非表示」に切り替える。
  // 非表示にするとインフォシート下部ブロックに自社名が表示される。
  await hideMemberInfo(listFrame).catch((err) => {
    console.warn(`  [ATBB] 会員間情報の非表示切替に失敗: ${err}`);
  });

  // エリア検索か地図検索かを判定
  const cardCount = await listFrame.evaluate(
    `document.querySelectorAll('div.property_card').length`
  ).catch(() => 0) as number;
  const isAreaSearch = cardCount > 0;

  if (isAreaSearch) {
    // --- エリア検索 (bfcm381s): div.property_card 構造 (全ページ) ---
    let areaPageNum = 1;
    while (true) {
      console.log(`  [ATBB] エリア検索ページ ${areaPageNum} をパース中...`);
      const rawList = await extractAreaSearchListData(listFrame);
      console.log(`  [ATBB] ${rawList.length} 件`);
      // インフォシートURLが空の物件は詳細ページをクリックして取得する
      for (let ri = 0; ri < rawList.length; ri++) {
        if (!rawList[ri]!.infoSheetUrl) {
          rawList[ri]!.infoSheetUrl = await fetchInfoSheetByCardDetail(atbbPage, listFrame, ri)
            .catch((err) => { console.warn(`  [ATBB] カード${ri} infoSheetUrl取得失敗: ${err}`); return ''; });
          if (rawList[ri]!.infoSheetUrl) {
            console.log(`  [ATBB] カード${ri} infoSheetUrl取得成功`);
          }
        }
      }
      for (const raw of rawList) {
        const { buildingName, roomNumber } = parseBuildingNameAndRoom(raw.nameAndRoom);
        listings.push({
          sourceId: raw.seigyoId,
          name: buildingName || raw.propertyType || '不明',
          roomNumber: roomNumber ?? null,
          address: raw.address,
          floor: raw.floorInfo ? parseFloor(raw.floorInfo) : null,
          layout: raw.layout || null,
          areaSquareMeters: parseSquareMeters(raw.area),
          rentYen: parseRentYen(raw.rentText),
          managementFeeYen: parseManagementFeeYen(raw.managementFeeText),
          nearestStation: raw.transport || null,
          infoSheetUrl: raw.infoSheetUrl || null,
          isNew: raw.isNew,
        });
      }
      const hasNext = await goToNextAreaPage(atbbPage, listFrame);
      if (!hasNext) break;
      await atbbPage.waitForTimeout(2000);
      areaPageNum++;
    }
    return listings;
  }

  // --- 地図検索 (bfcm380s028): 既存ページネーションループ ---
  let pageNum = 1;
  while (true) {
    console.log(`  [ATBB] ページ ${pageNum} をパース中...`);
    const rawList = await extractListData(listFrame);
    console.log(`  [ATBB] ${rawList.length} 件`);

    for (const raw of rawList) {
      const detail = await clickDetailAndExtract(atbbPage, listFrame, raw.bukkenId).catch((err) => {
        console.warn(`  [ATBB] 物件 ${raw.bukkenId} の詳細取得失敗: ${err}`);
        return null;
      });

      const { buildingName, roomNumber } = parseBuildingNameAndRoom(detail?.buildingNameRaw ?? '');

      listings.push({
        sourceId: raw.bukkenId,
        name: buildingName || raw.propertyType || '不明',
        roomNumber: roomNumber ?? null,
        address: detail?.address ?? '',
        floor: detail?.floorInfo ? parseFloor(detail.floorInfo) : null,
        layout: raw.floorPlan || detail?.floorPlan || null,
        areaSquareMeters: detail?.areaRaw ? parseSquareMeters(detail.areaRaw) : null,
        rentYen: parseRentYen(raw.rentText),
        managementFeeYen: parseManagementFeeYen(raw.managementFeeText),
        nearestStation: detail?.nearestStation ?? null,
        infoSheetUrl: raw.infoSheetUrl || null,
        isNew: raw.isNew,
      });
    }

    const hasNext = await goToNextPage(atbbPage, listFrame);
    if (!hasNext) break;
    await atbbPage.waitForTimeout(2000);
    pageNum++;
  }

  return listings;
}

// ---------------------------------------------------------------------------
// エリア検索: カードをクリックして詳細ページからインフォシートURLを取得
// ---------------------------------------------------------------------------

/**
 * 物件カードの「インフォシート」ボタン (button[name="infoSheet"]) をクリックし、
 * 新しく開いたタブ（インフォシートのPDF/HTML）のURLを取得して返す。
 * ボタンは BukkenIchiranInfoSheetClicked() でフォーム送信し新タブを開く。
 */
async function fetchInfoSheetByCardDetail(
  atbbPage: Page,
  listFrame: Frame,
  cardIndex: number,
): Promise<string> {
  // インフォシートボタンを特定（id="infoSheet_N" 優先、なければカード内の name="infoSheet"）
  let infoBtn = listFrame.locator(`#infoSheet_${cardIndex}`).first();
  if (await infoBtn.count() === 0) {
    infoBtn = listFrame.locator('div.property_card').nth(cardIndex).locator('button[name="infoSheet"]').first();
  }
  if (await infoBtn.count() === 0) {
    console.warn(`  [ATBB] カード${cardIndex}: インフォシートボタンが見つかりません`);
    return '';
  }

  await infoBtn.scrollIntoViewIfNeeded().catch(() => { /* ok */ });

  // クリックと同時に新タブの出現を待つ（フォーム送信で新タブが開く）
  const [newPage] = await Promise.all([
    atbbPage.context().waitForEvent('page', { timeout: 12000 }).catch(() => null),
    infoBtn.click().catch((e) => { console.warn(`  [ATBB] カード${cardIndex}: インフォシートクリック失敗 ${e}`); }),
  ]);

  if (!newPage) {
    console.warn(`  [ATBB] カード${cardIndex}: インフォシート新タブが開きませんでした`);
    return '';
  }

  try {
    await newPage.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => { /* ok */ });
    // 中間サーブレット (bfcm381s033 等) から infosheets ドメインへリダイレクトされるまで待つ
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const u = newPage.url();
      if (u.includes('zmn.atbb') || u.includes('infosheets') || u.toLowerCase().endsWith('.pdf')) break;
      await newPage.waitForTimeout(500);
    }
    await newPage.waitForTimeout(1000);
    const url = newPage.url();
    console.log(`  [ATBB DEBUG] カード${cardIndex} インフォシート新タブURL: ${url}`);
    return url && !url.startsWith('about:') ? url : '';
  } finally {
    await newPage.close();
  }
}

// ---------------------------------------------------------------------------
// bfcm381s (エリア検索) フレームから物件基本情報を抽出
// ---------------------------------------------------------------------------

interface RawAreaSearchProperty {
  seigyoId: string;
  isNew: boolean;
  nameAndRoom: string;
  propertyType: string;
  layout: string;
  area: string;
  floorInfo: string;
  address: string;
  transport: string;
  managementFeeText: string;
  rentText: string;
  infoSheetUrl: string;
}

async function extractAreaSearchListData(listFrame: Frame): Promise<RawAreaSearchProperty[]> {
  // JST (UTC+9) の今日の日付を "YYYY/MM/DD" 形式で取得
  const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = nowJst.toISOString().slice(0, 10).replace(/-/g, '/');
  return listFrame.evaluate(`
    (function() {
      var today = '${today}';
      var cards = document.querySelectorAll('div.property_card');

      return Array.prototype.slice.call(cards).map(function(card, i) {
        var seigyoInput = document.querySelector(
          'input[name="bukkenKensakuKekkaIchiranElement[' + i + '].seigyoId"]'
        );
        var seigyoId = seigyoInput ? seigyoInput.value : '';

        var nameEl = card.querySelector('.title-bar p.name');
        var nameAndRoom = nameEl ? nameEl.textContent.trim() : '';

        var typeEl = card.querySelector('.title-bar span.type');
        var propertyType = typeEl ? typeEl.textContent.trim() : '';

        var dateEl = card.querySelector('.title-bar p.date span');
        var dateStr = dateEl ? dateEl.textContent.trim() : '';
        var isNew = dateStr === today;

        function getThVal(label) {
          var rows = card.querySelectorAll('table tr');
          for (var r = 0; r < rows.length; r++) {
            var ths = rows[r].querySelectorAll('th');
            var tds = rows[r].querySelectorAll('td');
            for (var t = 0; t < ths.length; t++) {
              if (ths[t].textContent.trim().indexOf(label) !== -1 && tds[t]) {
                return tds[t].textContent.replace(/\\s+/g, ' ').trim();
              }
            }
          }
          return '';
        }

        var layout = getThVal('間取り');
        var area = getThVal('専有面積');
        var floorInfoRaw = getThVal('\u968e\u5efa/\u968e');
        var floorInfo = floorInfoRaw;

        var addrEl = card.querySelector('.map-address');
        var address = addrEl ? addrEl.textContent.replace(/\\s+/g, ' ').trim() : '';

        var allRows = Array.prototype.slice.call(card.querySelectorAll('table tr'));
        var transportRows = allRows.filter(function(r) {
          var th = r.querySelector('th');
          return th && th.textContent.indexOf('交通') !== -1;
        });
        var transport = transportRows.length > 0
          ? (transportRows[0].querySelector('td') ? transportRows[0].querySelector('td').textContent.replace(/\\s+/g, ' ').trim() : '')
          : '';

        // dl 内の dt ラベルに一致する dd のテキストを返す（div ラッパーあり・なし両対応）
        function getDlVal(label) {
          // ① div ラッパーあり: .payment dl div > dt/dd
          var allDivs2 = Array.prototype.slice.call(card.querySelectorAll('.payment dl div'));
          for (var di = 0; di < allDivs2.length; di++) {
            var dt2 = allDivs2[di].querySelector('dt');
            if (dt2 && dt2.textContent.indexOf(label) !== -1) {
              var dd2 = allDivs2[di].querySelector('dd');
              if (dd2) return dd2.textContent.trim();
            }
          }
          // ② div ラッパーなし: .payment dl > dt の nextElementSibling
          var dl = card.querySelector('.payment dl');
          if (dl) {
            var dts = dl.querySelectorAll('dt');
            for (var di2 = 0; di2 < dts.length; di2++) {
              if (dts[di2].textContent.indexOf(label) !== -1) {
                var sib = dts[di2].nextElementSibling;
                if (sib && sib.tagName === 'DD') return sib.textContent.trim();
              }
            }
          }
          return '';
        }

        var managementFeeText = getDlVal('管理費') || getThVal('管理費');

        // 賃料は txt2img で画像化されているため、まず hidden input から取得を試みる
        var hiddenRentText = (function() {
          var possibleNames = [
            'bukkenKensakuKekkaIchiranElement[' + i + '].chinryoKingaku',
            'bukkenKensakuKekkaIchiranElement[' + i + '].chinryo',
            'bukkenKensakuKekkaIchiranElement[' + i + '].registChinryo',
            'bukkenKensakuKekkaIchiranElement[' + i + '].tintaiRyoKingaku',
          ];
          for (var pi = 0; pi < possibleNames.length; pi++) {
            var inp = document.querySelector('input[name="' + possibleNames[pi] + '"]');
            if (inp && inp.value.trim()) return inp.value.trim();
          }
          return '';
        })();

        var rentText = hiddenRentText || getDlVal('賃料') || getThVal('賃料') || getThVal('家賃');

        // インフォシートURLをカード内の要素から直接探す
        var infoSheetUrl = (function() {
          var elems = card.querySelectorAll('a, button, input[type="button"]');
          for (var ei = 0; ei < elems.length; ei++) {
            var el = elems[ei];
            var elHref = el.href ? String(el.href) : (el.getAttribute('href') || '');
            var elOnclick = el.getAttribute('onclick') || '';
            var elText = (el.textContent || '').replace(/\\s/g, '');
            var imgAlt = (el.querySelector && el.querySelector('img')) ? (el.querySelector('img').getAttribute('alt') || '') : '';
            if (elHref.indexOf('infosheets') !== -1 || elOnclick.indexOf('infosheets') !== -1) {
              var m1 = elOnclick.match(/window\\.open\\s*\\(\\s*['"]([^'"]+)['"]/);
              if (m1) return m1[1].startsWith('http') ? m1[1] : window.location.origin + m1[1];
              if (elHref && !/^javascript/i.test(elHref) && elHref !== '#' && elHref !== window.location.href) return elHref;
            }
            if (elText.indexOf('\u30A4\u30F3\u30D5\u30A9\u30B7\u30FC\u30C8') !== -1 || imgAlt.indexOf('\u30A4\u30F3\u30D5\u30A9\u30B7\u30FC\u30C8') !== -1) {
              var m2 = elOnclick.match(/window\\.open\\s*\\(\\s*['"]([^'"]+)['"]/);
              if (m2) return m2[1].startsWith('http') ? m2[1] : window.location.origin + m2[1];
              if (elHref && !/^javascript/i.test(elHref) && elHref !== '#' && elHref !== window.location.href) return elHref;
            }
          }
          return '';
        })();

        return { seigyoId: seigyoId, nameAndRoom: nameAndRoom, propertyType: propertyType, isNew: isNew, layout: layout, area: area, floorInfo: floorInfo, address: address, transport: transport, managementFeeText: managementFeeText, rentText: rentText, infoSheetUrl: infoSheetUrl };
      });
    })()
  `) as Promise<RawAreaSearchProperty[]>;
}

// ---------------------------------------------------------------------------
// bfcm380s028 フレームから物件基本情報を抽出
// ---------------------------------------------------------------------------

interface RawListProperty {
  bukkenId: string;
  isNew: boolean;
  propertyType: string;
  floorPlan: string;
  rentText: string;
  managementFeeText: string;
  infoSheetUrl: string;
}

async function extractListData(listFrame: Frame): Promise<RawListProperty[]> {
  // DEBUG: bfcm004s015 の場合はHTML構造を確認
  const frameUrl = listFrame.url();
  if (/bfcm004s015/.test(frameUrl)) {
    const snippet = await listFrame.evaluate(`document.body.innerHTML.slice(0, 4000)`).catch(() => '');
    console.log(`  [ATBB DEBUG bfcm004s015] snippet:`, snippet);
  }
  return listFrame.evaluate(() => {
    const results: Array<{
      bukkenId: string; isNew: boolean; propertyType: string;
      floorPlan: string; rentText: string; managementFeeText: string; infoSheetUrl: string;
    }> = [];
    const idInputs = document.querySelectorAll<HTMLInputElement>('input[name="bukkenId"]');
    for (const idInput of idInputs) {
      const bukkenId = idInput.value;
      if (!bukkenId) continue;
      const trs = [...document.querySelectorAll<HTMLTableRowElement>(`tr[onclick*="${bukkenId}"]`)];
      if (trs.length < 3) continue;
      const cells0 = trs[0]!.querySelectorAll('td');
      const isNew = !!trs[0]!.querySelector('.red.small');
      const propertyType = (cells0[2]?.textContent ?? '').replace(/\u00a0/g, '').trim();
      const floorPlan = (cells0[3]?.textContent ?? '').replace(/\u00a0/g, '').trim();
      const cells1 = trs[1]!.querySelectorAll('td');
      const rentText = (cells1[0]?.textContent ?? '').trim();
      const managementFeeText = (cells1[2]?.textContent ?? '').replace(/\u00a0/g, '').trim();
      // インフォシートURLを周辺の行から抽出
      let infoSheetUrl = '';
      for (const tr of trs) {
        const anchors = tr.querySelectorAll('a');
        for (const anchor of anchors) {
          const text = (anchor.textContent ?? '').trim();
          if (text.includes('\u30A4\u30F3\u30D5\u30A9\u30B7\u30FC\u30C8')) {
            const href = anchor.href || '';
            if (href && !/^javascript/i.test(href) && href !== '#') {
              infoSheetUrl = href;
            } else {
              const oc = anchor.getAttribute('onclick') || '';
              const m = oc.match(/window\.open\s*\(\s*['"](\/[^'"]+)['"]/);
              if (m) infoSheetUrl = window.location.origin + m[1];
            }
            break;
          }
        }
        if (infoSheetUrl) break;
      }
      results.push({ bukkenId, isNew, propertyType, floorPlan, rentText, managementFeeText, infoSheetUrl });
    }
    return results;
  }) as Promise<RawListProperty[]>;
}

// ---------------------------------------------------------------------------
// 詳細ボタンをクリックして bfcm380s017 から詳細情報を取得
// ---------------------------------------------------------------------------

interface RawDetailInfo {
  buildingNameRaw: string;
  address: string;
  nearestStation: string;
  floorPlan: string;
  areaRaw: string;
  floorInfo: string;
}

async function clickDetailAndExtract(atbbPage: Page, listFrame: Frame, bukkenId: string): Promise<RawDetailInfo> {
  await closeColorbox(atbbPage);
  const shosaiBtn = listFrame.locator(`input[name="shosaiButton"][onclick*="${bukkenId}"]`);
  await shosaiBtn.click();
  await atbbPage.waitForTimeout(3000);

  const detailFrame = atbbPage.frames().find(f => f.url().includes('bfcm380s017'));
  if (!detailFrame) throw new Error(`bfcm380s017 フレームが見つかりません (bukkenId=${bukkenId})`);
  await detailFrame.waitForLoadState('domcontentloaded').catch(() => { /* ok */ });

  // NOTE: evaluate() にアロー関数式を渡すと tsx/esbuild が __name() ヘルパーを注入し
  //       ブラウザ内で ReferenceError になるため、文字列で直接渡す
  let result: RawDetailInfo;
  try {
    result = await detailFrame.evaluate(`
      (() => {
        const cells = Array.from(document.querySelectorAll('td.common-head'));
        const get = (label) => {
          const c = cells.find(el => el.textContent && el.textContent.trim() === label);
          return c && c.nextElementSibling ? c.nextElementSibling.textContent.replace(/\\s+/g, ' ').trim() : '';
        };
        const getContains = (label) => {
          const c = cells.find(el => el.textContent && el.textContent.includes(label));
          return c && c.nextElementSibling ? c.nextElementSibling.textContent.replace(/\\s+/g, ' ').trim() : '';
        };
        return {
          buildingNameRaw: get('建物名'),
          address: get('所在地'),
          nearestStation: getContains('交通'),
          floorPlan: get('間取り'),
          areaRaw: get('専有面積'),
          floorInfo: get('階建/階'),
        };
      })()
    `) as RawDetailInfo;
  } finally {
    await closeColorbox(atbbPage);
  }
  return result;
}

async function closeColorbox(atbbPage: Page): Promise<void> {
  await atbbPage.evaluate(() => {
    const win = window as unknown as { jQuery?: { colorbox?: { close: () => void } } };
    win.jQuery?.colorbox?.close();
    document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 27, key: 'Escape', bubbles: true, cancelable: true }));
  }).catch(() => { /* ok */ });
  await atbbPage.waitForTimeout(800);
}

async function goToNextAreaPage(atbbPage: Page, listFrame: Frame): Promise<boolean> {
  // エリア検索のページネーション「次へ」リンク
  const nextLink = listFrame.locator('a:has-text("次へ")').first();
  if (await nextLink.count() === 0) return false;
  // 現ページの最初の property_card のテキストを記録して、変わるまで待つ
  const firstCardText = await listFrame.locator('div.property_card').first().textContent().catch(() => '');
  await nextLink.click();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await atbbPage.waitForTimeout(500);
    try {
      const newCardText = await listFrame.locator('div.property_card').first().textContent().catch(() => null);
      if (newCardText !== null && newCardText !== firstCardText) break;
    } catch { break; }
  }
  await atbbPage.waitForTimeout(1000);
  return true;
}

async function goToNextPage(atbbPage: Page, listFrame: Frame): Promise<boolean> {
  const nextLink = listFrame.locator('a:has-text("次ページ"), a:has-text("次の"), input[value="次"]').first();
  if (await nextLink.count() === 0) return false;
  // 現ページの最初のbukkenIdを記録して、変わるまで待つ
  const firstId = await listFrame.locator('input[name="bukkenId"]').first().getAttribute('value').catch(() => '');
  await nextLink.click();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await atbbPage.waitForTimeout(500);
    try {
      const newId = await listFrame.locator('input[name="bukkenId"]').first().getAttribute('value').catch(() => null);
      if (newId !== null && newId !== firstId) break;
    } catch { break; }
  }
  await atbbPage.waitForTimeout(1000);
  return true;
}

// ---------------------------------------------------------------------------
// ヘルパー関数
// ---------------------------------------------------------------------------

function parseBuildingNameAndRoom(raw: string): { buildingName: string; roomNumber: string | null } {
  const normalized = raw.normalize('NFKC').trim();
  // 「建物名 部屋番号：XXX」形式（地図検索）
  const roomNoMatch = normalized.match(/^(.+?)\s+部屋番号[：:]\s*(.+?)$/);
  if (roomNoMatch) return { buildingName: roomNoMatch[1]!.trim(), roomNumber: roomNoMatch[2]!.trim() };
  // 「建物名/部屋番号」形式（エリア検索: 例 「コンフォート白金/１０５」）
  const slashMatch = normalized.match(/^(.+?)[/／]([A-Za-z0-9０-９ａ-ｚＡ-Ｚ]+)$/);
  if (slashMatch) return { buildingName: slashMatch[1]!.trim(), roomNumber: slashMatch[2]!.trim() };
  // 「建物名 部屋番号」形式（末尾が部屋番号らしき場合: 例 「エルファーロ大塚IV 0302」）
  const spaceMatch = normalized.match(/^(.+?)\s+([A-Z0-9]{3,6})$/);
  if (spaceMatch) return { buildingName: spaceMatch[1]!.trim(), roomNumber: spaceMatch[2]!.trim() };
  return { buildingName: normalized, roomNumber: null };
}

function parseFloor(floorInfo: string): string | null {
  const normalized = floorInfo.normalize('NFKC');
  // "X階建/Y階" 形式（エリア検索）→ 部屋の階数 Y を取り出す
  const buildingFloorMatch = normalized.match(/(\d+)階建\/(\d+)階/);
  if (buildingFloorMatch) return `${buildingFloorMatch[2]}階`;
  const partMatch = normalized.match(/(\d+)階部分/);
  if (partMatch) return `${partMatch[1]}階`;
  const simpleMatch = normalized.match(/(\d+)階/);
  if (simpleMatch) return `${simpleMatch[1]}階`;
  return floorInfo || null;
}

function parseSquareMeters(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.normalize('NFKC').replace(',', '').match(/[\d]+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function parseRentYen(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.normalize('NFKC').replace(/[,，\s]/g, '');
  const manYen = normalized.match(/([\d]+(?:\.[\d]+)?)万円/);
  if (manYen?.[1]) return Math.round(Number(manYen[1]) * 10000);
  const yen = normalized.match(/[\d]+/);
  return yen ? Number(yen[0]) : null;
}

function parseManagementFeeYen(value: string | null | undefined): number | null {
  if (!value || value === 'なし' || value === '-') return null;
  const normalized = value.normalize('NFKC').replace(/,/g, '');
  const match = normalized.match(/[\d]+/);
  return match ? Number(match[0]) : null;
}

// ---------------------------------------------------------------------------
// ファクトリ
// ---------------------------------------------------------------------------

export function createAtbbClient(config: AppConfig): AtbbClient {
  if (config.ATBB_SOURCE_MODE === 'browser') {
    return new BrowserAtbbClient(config);
  }
  return new FixtureAtbbClient(config.ATBB_FIXTURE_PATH);
}
