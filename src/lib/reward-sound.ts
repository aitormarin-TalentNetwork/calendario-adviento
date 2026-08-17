/**
 * TAL-40 — sonido de premio sintetizado con Web Audio API para el efecto
 * de "primera apertura" (design/design-system.md § "Grid de días" →
 * "Efecto de 'primera apertura'"): "un 'crac' corto seguido de un
 * arpegio ascendente tipo 'logro desbloqueado' — sintetizado, no un
 * fichero de audio externo". Portado 1:1 del prototipo funcional
 * `design/propuesta-grid-calendario.html` (`playRewardSound`) — mismas
 * frecuencias/tiempos, sin ningún asset (evita añadir un fichero de
 * audio con su propio peso/licencia, tal como pide el brief).
 *
 * `AudioContext` como singleton perezoso a nivel de módulo (igual que el
 * prototipo): crearlo antes del primer gesto real del usuario lo deja
 * "suspended" en la mayoría de navegadores, así que no tiene sentido
 * instanciarlo al cargar la página — solo la primera vez que de verdad
 * suena algo (siempre dentro de un `onClick`, ya es un gesto de usuario
 * válido).
 */

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

export function playRewardSound(): void {
  const ac = getAudioCtx();
  const now = ac.currentTime;

  // "crac" de piñata — ruido filtrado, muy corto
  const bufferSize = ac.sampleRate * 0.12;
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const noise = ac.createBufferSource();
  noise.buffer = buffer;
  const bandpass = ac.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = 1400;
  bandpass.Q.value = 0.9;
  const crackGain = ac.createGain();
  crackGain.gain.setValueAtTime(0.5, now);
  crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  noise.connect(bandpass).connect(crackGain).connect(ac.destination);
  noise.start(now);
  noise.stop(now + 0.13);

  // arpegio ascendente de premio (estilo "logro desbloqueado")
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C5 E5 G5 C6 E6
  notes.forEach((freq, i) => {
    const t = now + 0.08 + i * 0.09;
    const osc = ac.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.42);
  });

  // brillo final (shimmer)
  [1568, 2093, 2637].forEach((freq, i) => {
    const t = now + 0.42 + i * 0.02;
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.65);
  });
}
