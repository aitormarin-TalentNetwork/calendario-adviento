-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- Verificación explícita de colisiones antes de convertir tipos. Sin este
-- bloque, si ya existiera data bajo el esquema anterior que colisiona con
-- las reglas nuevas (dos "Day" del mismo calendario con distinta hora pero
-- la misma fecha natural, o emails que solo difieren en mayúsculas),
-- Postgres abortaría el ALTER más abajo con un error genérico de violación
-- de unicidad, a medio DDL. No hay una resolución automática segura (no se
-- puede adivinar qué fila conservar ni fusionar mensajes/roles por sí
-- solo), así que la migración falla aquí con un diagnóstico claro y hay que
-- resolver la colisión a mano (decidir qué fila conservar) antes de
-- reaplicarla.
DO $$
DECLARE
  day_collisions integer;
  user_email_collisions integer;
  invitation_email_collisions integer;
BEGIN
  SELECT count(*) INTO day_collisions FROM (
    SELECT "calendarId", "date"::date
    FROM "Day"
    GROUP BY "calendarId", "date"::date
    HAVING count(*) > 1
  ) collisions;
  IF day_collisions > 0 THEN
    RAISE EXCEPTION 'Migración abortada: % grupo(s) de "Day" del mismo calendario colisionan al recortar "date" a un día natural (misma fecha, distinta hora). Resuelve la colisión a mano (decide qué Day conservar) antes de reaplicar esta migración.', day_collisions;
  END IF;

  SELECT count(*) INTO user_email_collisions FROM (
    SELECT lower(email)
    FROM "User"
    GROUP BY lower(email)
    HAVING count(*) > 1
  ) collisions;
  IF user_email_collisions > 0 THEN
    RAISE EXCEPTION 'Migración abortada: % email(s) de "User" colisionan solo por mayúsculas/minúsculas al pasar a CITEXT. Resuelve la colisión a mano (decide qué User conservar y reasigna sus referencias) antes de reaplicar esta migración.', user_email_collisions;
  END IF;

  SELECT count(*) INTO invitation_email_collisions FROM (
    SELECT "calendarId", lower(email)
    FROM "Invitation"
    GROUP BY "calendarId", lower(email)
    HAVING count(*) > 1
  ) collisions;
  IF invitation_email_collisions > 0 THEN
    RAISE EXCEPTION 'Migración abortada: % invitación(es) del mismo calendario colisionan solo por mayúsculas/minúsculas al pasar "email" a CITEXT. Resuelve la colisión a mano antes de reaplicar esta migración.', invitation_email_collisions;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Day" ALTER COLUMN "date" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "Invitation" ALTER COLUMN "email" SET DATA TYPE CITEXT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "email" SET DATA TYPE CITEXT;
