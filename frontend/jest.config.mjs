// Next.js 付属の設定（SWC で TypeScript を変換）を使う。型チェックは npm run typecheck で行う
import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

export default createJestConfig({
  // 画面コンポーネントのテスト（段階8）はファイル単位で jsdom に切り替える
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts"],
});
