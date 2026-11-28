/**
 * For something a screen owns and must dispose when it is closed, used from an effect. React may run an effect's cleanup and
 * then the effect again without closing the screen (development Strict Mode, Fast Refresh); disposing at once would leave the
 * screen holding a dead object. So the disposal waits a moment and is dropped when the effect has run again.
 */
export function disposeWhenGone(): (dispose: () => void) => () => void {
  let runs = 0;
  return (dispose) => {
    const run = ++runs;
    return () =>
      queueMicrotask(() => {
        if (runs === run) dispose();
      });
  };
}
