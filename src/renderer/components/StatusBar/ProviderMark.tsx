import type { QuotaProvider } from '@shared/quota'

/**
 * The agent marks that replaced the words "Claude" and "Codex" in the footer.
 *
 * With two agents the names cost more room than the gauges they introduced,
 * and the footer is one line shared with the machine load. A 14 px mark says
 * the same thing in a tenth of the width — which is the entire reason this
 * file exists.
 *
 * **Claude** is the real Anthropic mark. **Codex is deliberately not the
 * OpenAI one**: that logo was withdrawn from the icon set everyone redistributes
 * at OpenAI's own request, and drawing a trademark from memory produces a bad
 * copy of someone else's property. The rosette below is of the same visual
 * family without pretending to be the mark, and the tooltip and the colour
 * carry the identity the way the word used to.
 *
 * Neither mark is decorative: each carries the provider name as its accessible
 * label, because it is now the only thing naming the gauges beside it.
 */

/** The Anthropic mark, 24×24. */
const CLAUDE_PATH =
  'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'

/**
 * One petal of the Codex rosette, as a lens from 2.6 to 14.4 on the vertical.
 *
 * It reaches 2.4 units *past* the centre on purpose: six of these, rotated and
 * filled with the even-odd rule, overlap in the middle and carve the interlace
 * out rather than filling it in. A petal stopping at the centre would give a
 * solid flower, which is the one shape that would read as a second sunburst
 * next to Claude's.
 */
const PETAL: [number, number][][] = [
  [
    [12, 2.6],
    [15.4, 5.6],
    [15.4, 11.4],
    [12, 14.4],
  ],
  [
    [8.6, 11.4],
    [8.6, 5.6],
    [12, 2.6],
  ],
]

function rotate([x, y]: [number, number], degrees: number): string {
  const radians = (degrees * Math.PI) / 180
  const [dx, dy] = [x - 12, y - 12]
  const rx = 12 + dx * Math.cos(radians) - dy * Math.sin(radians)
  const ry = 12 + dx * Math.sin(radians) + dy * Math.cos(radians)
  return `${rx.toFixed(2)} ${ry.toFixed(2)}`
}

/**
 * Six petals, 60° apart, as one path so the even-odd rule sees them together.
 *
 * Generated rather than written out: twelve hand-rotated control points is
 * twelve chances to be one decimal off, and nothing in a review would catch it.
 */
const CODEX_PATH = [0, 60, 120, 180, 240, 300]
  .map((angle) => {
    const [first, second] = PETAL
    const start = rotate(first![0]!, angle)
    const curve1 = first!.slice(1).map((point) => rotate(point, angle)).join(' ')
    const curve2 = second!.map((point) => rotate(point, angle)).join(' ')
    return `M${start}C${curve1}C${curve2}Z`
  })
  .join('')

const LABELS: Record<QuotaProvider, string> = { claude: 'Claude', codex: 'Codex' }

/** Tailwind text colour per provider; the marks are painted with currentColor. */
export const PROVIDER_TEXT: Record<QuotaProvider, string> = {
  claude: 'text-quota-claude',
  codex: 'text-quota-codex',
}

/** Fill for a gauge at a nominal level — the other half of the identity. */
export const PROVIDER_FILL: Record<QuotaProvider, string> = {
  claude: 'bg-quota-claude',
  codex: 'bg-quota-codex',
}

export function ProviderMark({ provider }: { provider: QuotaProvider }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={LABELS[provider]}
      data-provider-mark={provider}
      className={`size-3.5 shrink-0 ${PROVIDER_TEXT[provider]}`}
    >
      <title>{LABELS[provider]}</title>
      {provider === 'claude' ? (
        <path d={CLAUDE_PATH} fill="currentColor" />
      ) : (
        <path d={CODEX_PATH} fill="currentColor" fillRule="evenodd" />
      )}
    </svg>
  )
}
