import katex from 'katex'
import { useMemo } from 'react'

export function Tex({ latex, display = false }: { latex: string; display?: boolean }) {
  const html = useMemo(
    () => katex.renderToString(latex, { throwOnError: false, displayMode: display, output: 'html' }),
    [latex, display],
  )
  return <span className={display ? 'tex tex-display' : 'tex'} dangerouslySetInnerHTML={{ __html: html }} />
}
