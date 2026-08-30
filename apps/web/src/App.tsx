import { Lab } from './lab/Lab';
import { Trainer } from './ui/Trainer';

/**
 * `?lab=1` opens the measurement harness from spike 2 — the knobs, the raw
 * hypotheses and the JSON report. It is kept because the recogniser will need
 * re-measuring on every new device, and it has no place in the trainer itself.
 */
export function App() {
  const lab = new URLSearchParams(window.location.search).has('lab');
  return lab ? <Lab /> : <Trainer />;
}
