/**
 * Aviso del editor que NO bloquea (TAL-66: vídeo no incrustable; TAL-69:
 * URL de imagen que es una página). Misma clase (`.day-video-warning`,
 * --ink sobre --surface-2), mismos tokens y `role="status"` en los dos.
 */
export function EditorWarning({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="day-video-warning">
      {children}
    </p>
  );
}
