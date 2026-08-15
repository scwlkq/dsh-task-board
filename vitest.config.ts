import { defineConfig } from "vitest/config"
import ts from "typescript"
import { fileURLToPath } from "node:url"

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

function standardDecoratorPlugin() {
  return {
    name: "dsh-standard-decorators",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const file = id.split("?", 1)[0]
      if (file === undefined || !/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return

      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          ...(file.endsWith("x") ? { jsx: ts.JsxEmit.ReactJSX } : {}),
          sourceMap: true,
        },
      })
      return {
        code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, "\n"),
        map: result.sourceMapText,
      }
    },
  }
}

export default defineConfig({
  plugins: [standardDecoratorPlugin()],
  resolve: {
    alias: {
      "@deepseek-ai/dsh-client-runtime/client": fileURLToPath(new URL("./tests/support/client-runtime.ts", import.meta.url)),
      "@deepseek-ai/dsh-client-web-react": fileURLToPath(new URL("./tests/support/client-web-react.ts", import.meta.url)),
      "@deepseek-ai/dsh-client-locale/client": fileURLToPath(new URL("./tests/support/client-locale.ts", import.meta.url)),
      "@deepseek-ai/dsh-client-test-runtime": fileURLToPath(new URL("./tests/support/client-test-runtime.ts", import.meta.url)),
      "@deepseek-ai/dsh-client-ui-primitives": fileURLToPath(new URL("./tests/support/ui-primitives.tsx", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
})
