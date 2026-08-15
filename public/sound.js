// Web Audio API による効果音再生エンジン
(() => {
  let audioCtx = null;

  const getAudioContext = () => {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  };

  const isSoundEnabled = () => {
    try {
      const settings = JSON.parse(localStorage.getItem('shopping-settings-v1') || '{}');
      return Boolean(settings.sound);
    } catch (e) {
      return false;
    }
  };

  const playTone = (freq, duration, type = 'sine', startTimeOffset = 0, gainLevel = 0.15) => {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + startTimeOffset);

    gain.gain.setValueAtTime(gainLevel, ctx.currentTime + startTimeOffset);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startTimeOffset + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime + startTimeOffset);
    osc.stop(ctx.currentTime + startTimeOffset + duration);
  };

  window.AppSound = {
    play: (soundType, force = false) => {
      if (!force && !isSoundEnabled()) return;

      try {
        switch (soundType) {
          case 'add':
            // 追加：軽快な上昇ポップ音
            playTone(523.25, 0.08, 'triangle', 0, 0.14);
            playTone(783.99, 0.12, 'sine', 0.06, 0.16);
            break;

          case 'check':
            // チェック完了：明るいピンポンチャイム
            playTone(880, 0.08, 'triangle', 0, 0.16);
            playTone(1318.51, 0.15, 'sine', 0.07, 0.18);
            break;

          case 'uncheck':
            // 未完了に戻す：落ち着いた下降トーン
            playTone(659.25, 0.08, 'sine', 0, 0.12);
            playTone(440.0, 0.1, 'sine', 0.06, 0.1);
            break;

          case 'delete':
            // 削除：短いポップ音
            playTone(220, 0.08, 'sine', 0, 0.15);
            break;

          case 'all-done':
            // 全完了：ファンファーレ (C5 -> E5 -> G5 -> C6)
            playTone(523.25, 0.1, 'triangle', 0, 0.16);
            playTone(659.25, 0.1, 'triangle', 0.1, 0.16);
            playTone(783.99, 0.12, 'triangle', 0.2, 0.18);
            playTone(1046.5, 0.35, 'sine', 0.32, 0.22);
            break;

          case 'test':
            // 設定確認用：ポロン♪
            playTone(783.99, 0.1, 'triangle', 0, 0.15);
            playTone(1046.5, 0.2, 'sine', 0.09, 0.2);
            break;

          case 'save':
            // メモ保存：静かな確認音
            playTone(880, 0.12, 'sine', 0, 0.1);
            break;
        }
      } catch (e) {
        console.warn('効果音再生エラー:', e);
      }
    }
  };
})();
