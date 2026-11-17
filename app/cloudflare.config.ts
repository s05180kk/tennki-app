import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "tennki-app",
		compatibilityDate: "2026-11-01",
		entrypoint,
		workersDev: true,
		// プレビューURLは Access の対象外になりうるので無効にする
		previewUrls: false,
		assets: {
			// 静的ファイルも必ず Worker の認証を通す
			runWorkerFirst: true,
		},
		env: {
			ASSETS: bindings.assets(),
			// KV のキー:
			//   config:access … Access 検証の設定 {"teamDomain": "...", "aud": "..."}
			//   data:data.js  … 問題データ（リポジトリには含めない）
			//   stats:<email> … ユーザーごとの学習記録
			KV: bindings.kv({ id: "3082396d801b4597b57d0d22eafcda52" }),
		},
	},
});
