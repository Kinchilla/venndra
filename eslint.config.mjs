import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Flat config, because ESLint 10 no longer reads .eslintrc.json at all and
// `next lint` no longer exists to find it. Same two configs and the same three
// rule decisions as the .eslintrc.json this replaces -- see a63e89b for why
// no-explicit-any and no-unescaped-entities are warnings rather than errors,
// and why no-unused-vars needs ignoreRestSiblings.
export default defineConfig([
  {
    ignores: [".next/**", "node_modules/**"],
  },
  {
    extends: [...nextCoreWebVitals, ...nextTypescript],

    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react/no-unescaped-entities": "warn",

      // New in eslint-config-next 16, and mostly right: setState in an effect
      // does cost a second render pass. But the deliberate exception is the
      // one pattern this app uses it for -- hooks/useClientValue defers an
      // environment-dependent value (Intl, "today") until after hydration
      // precisely BY setting state in an effect, because rendering the real
      // value on the first pass is what causes hydration crashes. The rule
      // cannot tell that apart from an accidental cascade, so it advises
      // rather than blocks.
      "react-hooks/set-state-in-effect": "warn",

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          ignoreRestSiblings: true,
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
]);
