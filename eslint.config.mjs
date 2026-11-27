import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // scripts/import-mext-foods.cjs and scripts/post-bakery-article.cjs are
  // intentional CommonJS entry-point scripts (the .cjs extension forces
  // CommonJS module resolution regardless of package.json's "type" field),
  // so require() is the only valid module syntax there -- converting them
  // to `import` would require renaming to .mjs, a larger and unrelated
  // change to these protected, manually-run production data/PR scripts.
  // This exception is scoped to exactly these two known files, not to
  // .cjs files or scripts/** in general, so any future .cjs script is
  // still linted by this rule by default.
  {
    files: [
      "scripts/import-mext-foods.cjs",
      "scripts/post-bakery-article.cjs",
    ],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
