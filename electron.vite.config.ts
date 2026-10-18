import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * 生产构建时注入 CSP meta 标签
 *
 * 为什么只在构建阶段注入，而不是直接写进 index.html：
 *   `npm run dev` 下 @vitejs/plugin-react 会往 HTML 里插入一段内联脚本
 *   （react-refresh 预置代码）用于 HMR，严格的 `script-src 'self'` 会把它拦掉，
 *   导致开发模式白屏。所以 dev 不注入，打包产物注入严格策略。
 *
 * 策略要点：
 *   - default-src 'self'      默认只允许同源资源
 *   - script-src 'self'       禁止任何内联/远程脚本（XSS 无法执行注入代码）
 *   - style-src  'self' 'unsafe-inline'
 *                             允许内联样式：React 的 style={{...}} 与 index.html
 *                             里防闪屏的内联 <style> 都依赖它
 *   - img-src 'self' data:    图标/内联图片
 *   - connect-src 'self'      应用不发任何网络请求
 *   - object-src/base-uri/form-action/frame-src 'none'  关闭无关能力
 */
const CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "font-src 'self' data:; " +
  "connect-src 'self'; " +
  "object-src 'none'; " +
  "base-uri 'none'; " +
  "form-action 'none'; " +
  "frame-src 'none'"

function injectCsp(): Plugin {
  return {
    name: 'passbox-inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      // 必须插在 <head> 之后、任何 <script>/<style> 之前：
      // meta CSP 只对出现在它之后的内容生效，放在 </head> 前会漏掉 Vite 注入的入口脚本。
      return html.replace(
        /<head>/,
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react(), injectCsp()]
  }
})
