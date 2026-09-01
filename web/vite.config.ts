import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite の設定。React プラグインを有効にするだけのシンプルな構成。
export default defineConfig({
  plugins: [react()],
});
