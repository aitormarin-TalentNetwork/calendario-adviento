-- Trigger de integridad: impide reducir/mover el rango de fechas de un
-- Calendar (startDate/endDate) si dejaría algún "Day" existente fuera del
-- rango nuevo.
--
-- Contexto (hallazgo de auditoría, TAL-6, ronda 3): guardar un Day valida
-- en aplicación (dentro de una transacción con SELECT ... FOR UPDATE sobre
-- la fila del Calendar) que la fecha está dentro del rango en ese momento.
-- Eso serializa correctamente frente a OTRO saveDayAction concurrente, pero
-- no frente a updateCalendarAction (TAL-5): nada impedía que, DESPUÉS de
-- guardar un Day, alguien redujera el rango del calendario sin comprobar
-- los días ya guardados — el Day quedaba huérfano fuera de rango (oculto
-- en la rejilla de TAL-6, reapareciendo si el rango se ampliaba después).
--
-- En vez de tocar updateCalendarAction (src/app/admin/actions.ts, TAL-5,
-- activamente en manos de otra terminal en paralelo) para meterlo en el
-- mismo protocolo de aplicación, la invariante "todo Day está dentro del
-- rango de su Calendar" se hace cumplir aquí, a nivel de base de datos: un
-- trigger que se dispara en CUALQUIER UPDATE de "Calendar" que cambie
-- startDate/endDate, sea cual sea el código de aplicación que lo dispare
-- (actual o futuro) — más fuerte que cualquier acuerdo entre trozos de
-- aplicación distintos, y no requiere coordinación entre terminales para
-- mantenerse correcto según crezca el código.
CREATE OR REPLACE FUNCTION reject_calendar_range_shrink_with_orphaned_days()
RETURNS TRIGGER AS $$
DECLARE
  orphaned_days integer;
BEGIN
  IF NEW."startDate" IS DISTINCT FROM OLD."startDate"
     OR NEW."endDate" IS DISTINCT FROM OLD."endDate" THEN
    SELECT count(*) INTO orphaned_days
    FROM "Day"
    WHERE "calendarId" = NEW.id
      AND ("date" < NEW."startDate" OR "date" > NEW."endDate");

    IF orphaned_days > 0 THEN
      RAISE EXCEPTION 'No se puede cambiar el rango de fechas del calendario: % día(s) con vídeo asignado quedarían fuera del rango nuevo. Quítales el vídeo (o muévelos) antes de acortar/mover el rango.', orphaned_days;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calendar_range_change_guard
BEFORE UPDATE ON "Calendar"
FOR EACH ROW
EXECUTE FUNCTION reject_calendar_range_shrink_with_orphaned_days();
