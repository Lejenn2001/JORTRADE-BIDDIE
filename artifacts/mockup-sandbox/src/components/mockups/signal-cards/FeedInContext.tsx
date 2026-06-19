import { FeedCompact } from "./FeedCompact";

// "In Context" now mirrors the finalized Decision Engine feed design so both
// canvas shapes stay consistent. Single source of truth: FeedCompact.
export function FeedInContext() {
  return <FeedCompact />;
}
