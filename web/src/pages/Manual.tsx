import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { supabase } from "../lib/supabase";

// マニュアル画像は Supabase Storage の非公開バケットに置く。
// web/public/ に置くと静的ファイルとして誰でも直接URLで取得できてしまい、
// React側の認証ガードが効かないため（顧客の個人情報が写り込むので不可）。
const MANUAL_BUCKET = "manual-images";
// 署名付きURLの有効期限（秒）。閲覧中に切れない程度の短さにする。
const SIGNED_URL_TTL_SECONDS = 60 * 30;

/**
 * ログイン済みユーザーとしてバケット内の全画像の署名付きURLをまとめて取得する。
 * 未ログインの場合はRLSにより発行されないので、画像は表示されない。
 */
function useManualImageUrls(fileNames: string[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // fileNames は毎回同じ並びなので、結合した文字列を依存値にする
  const key = fileNames.join("|");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { data, error } = await supabase.storage
        .from(MANUAL_BUCKET)
        .createSignedUrls(fileNames, SIGNED_URL_TTL_SECONDS);

      if (cancelled) return;

      if (error) {
        setError("画像を読み込めませんでした。ログイン状態をご確認ください。");
        return;
      }

      const next: Record<string, string> = {};
      for (const item of data ?? []) {
        if (item.signedUrl && item.path) next[item.path] = item.signedUrl;
      }
      setUrls(next);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { urls, error };
}

// マニュアル内のスクリーンショット。src には署名付きURLが入る。
function Shot({ src, alt }: { src: string | undefined; alt: string }) {
  return (
    <figure className="manual-figure">
      {src ? (
        <img src={src} alt={alt} loading="lazy" />
      ) : (
        <div className="manual-figure-placeholder">画像を読み込み中...</div>
      )}
      <figcaption>{alt}</figcaption>
    </figure>
  );
}

/** マニュアルで使う画像のファイル名（バケット内のパス） */
// Supabase Storage のキーは ASCII のみ。
// scripts/upload-manual-images.ts の NAME_MAP と一致させること。
const SHOTS = {
  search: "search-properties.png",
  saveCondition: "save-condition.png",
  userList: "line-user-list.png",
  searchResult: "line-user-search-result.png",
  titleExample: "title-input-example.png",
} as const;

const SHOT_FILES = Object.values(SHOTS);

export default function Manual() {
  const { urls, error } = useManualImageUrls([...SHOT_FILES]);

  return (
    <>
      <TopBar title="操作マニュアル" />
      <main className="container">
        <div className="card manual">
          {error && <div className="note">{error}</div>}
          <p>
            このマニュアルは、物件が更新されたときに自動的にLINEで通知できるようにするためのマニュアルです。
          </p>

          <h2>1. ATBBで検索条件を作る</h2>
          <ol>
            <li>ATBBにログインします。</li>
            <li>物件の条件を入力して検索します。</li>
          </ol>
          <Shot src={urls[SHOTS.search]} alt="物件を検索する画面" />
          <div className="note">
            「<strong>地図から探す</strong>」ではなく「<strong>所在地/沿線から探す</strong>」を選んでください。
          </div>

          <h2>2. 検索条件を保存する</h2>
          <ol>
            <li>検索したら、その条件を保存します。</li>
            <li>
              保存するときに<strong>タイトル</strong>を入力します。
              このタイトルに<strong>LINEユーザーID</strong>を入れます（付け方は手順4）。
            </li>
          </ol>
          <Shot src={urls[SHOTS.saveCondition]} alt="検索条件の保存とタイトルの入力" />

          <h2>3. LINEユーザーIDを調べる</h2>
          <ol>
            <li>
              <Link to="/users">LINEユーザー一覧</Link>
              を開きます。
            </li>
            <li>
              検索ボックスにお客様の<strong>LINEの表示名</strong>を入力して探します。
            </li>
            <li>目的のお客様の行が見つかったら、LINEユーザーIDを<strong>コピー</strong>します。</li>
          </ol>
          <Shot src={urls[SHOTS.userList]} alt="LINEの表示名で検索する" />
          <Shot src={urls[SHOTS.searchResult]} alt="LINEの表示名の検索結果" />

          <h2>4. タイトルにLINEユーザーIDを入れる</h2>
          <p>コピーしたLINEユーザーIDを、ATBBの検索条件保存のタイトルに貼り付けます。形式は次のとおりです。</p>
          <p>
            <code>{"{LINEユーザーID}_xxx"}</code>
            （<code>xxx</code> はお客様の名前など、任意のテキスト）
          </p>
          <p>
            例: <code>U1a2b3c4d5..._山田太郎</code>
          </p>
          <Shot src={urls[SHOTS.titleExample]} alt="検索条件保存のタイトル入力例" />
          <div className="note">
            この形式で保存されていて、かつそのLINEユーザーIDが
            <Link to="/users">LINEユーザー一覧</Link>に存在するお客様だけが、通知の対象になります。
          </div>

          <h2>5. 通知のしくみ</h2>
          <ul>
            <li>
              <strong>8〜22時の間、1時間ごと</strong>に更新を確認し、更新があったお客様に通知します。
            </li>
            <li>一度通知した物件と同じ物件は、再度通知しません（次の「同一物件の判定」を参照）。</li>
          </ul>

          <h2>同一物件の判定</h2>
          <p>次の4つの情報がすべて同じなら、同じ物件とみなします。</p>
          <ul>
            <li>建物名</li>
            <li>所在地</li>
            <li>間取り</li>
            <li>専有面積</li>
          </ul>
          <p>
            <strong>部屋番号と階数は同一判定に使いません。</strong>
            号室や階が違っても、間取りと専有面積が同じであれば同一物件とみなし、重複通知を避けます。
          </p>
          <p>
            <strong>家賃・管理費・管理会社情報も同一判定に使いません。</strong>
            家賃変更や管理会社側の修正で、同じ物件が再通知されるのを避けるためです。
          </p>

          <h3>同じ物件を二重に通知しないしくみ</h3>
          <ul>
            <li>
              <strong>1回の確認で同じ物件が複数見つかった場合</strong>（例: マンションA 1K 204号室 と 205号室）は、
              一覧で先に出てきた1件だけを通知します（通常は号室の若い方）。残りは通知しません。
            </li>
            <li>
              <strong>過去に通知済みの物件</strong>は、号室・階・家賃が違っても、
              建物名・所在地・間取り・専有面積が同じであれば再通知しません
              （例: 204号室を通知済みなら、後から出た 305号室も通知しない）。
            </li>
            <li>
              逆に、<strong>専有面積や間取りが違えば別物件</strong>として通知します。
              同じ「1K」でも専有面積が異なれば別物件です。
            </li>
            <li>
              判定を分けるのは家賃ではなく専有面積です。家賃が違っても専有面積などが同じなら同一物件、
              家賃が同じでも専有面積が違えば別物件です。
            </li>
          </ul>
        </div>
      </main>
    </>
  );
}
