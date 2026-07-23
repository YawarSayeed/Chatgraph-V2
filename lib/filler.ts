/**
 * Deterministic filler detection, shared by the product and the evaluation
 * harness so "eligible turn" means the same thing in both. A filler turn is
 * navigation or acknowledgment — it carries no extractable knowledge, and the
 * live audit showed extraction on such turns fabricates facts and mutates
 * existing ones ("Continue" turns re-emitted and corrupted prior concepts).
 */

const FILLER_PATTERN =
  /^(okay|ok|no|sounds great|let'?s go|yeah)?[,! ]*(continue|move on|next question|no[, ]*move on|let'?s move on|go on|that would be it|no|yes|sorry,? you can just move on|i want to continue|you want to continue\??|yeah continue please|yeah,? let'?s continue|no,? i think this is it)[.! ]*$/i;

const SHORT_ACKS =
  /^(ok|okay|yes|yeah|no|sure|continue|move on|next|thanks?|thank you|world)$/i;

export function isFillerTurn(text: string): boolean {
  const value = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!value) return true;
  if (/^(okay,? sounds great\.? let'?s go|sounds great\.? let'?s go|sure,? let'?s (go|start|begin)( ahead)?)$/i.test(value)) return true;
  const words = value.split(" ");
  if (words.length <= 3 && words.every((word) => SHORT_ACKS.test(word.replace(/[.,!?]/g, "")))) return true;
  return FILLER_PATTERN.test(value);
}
