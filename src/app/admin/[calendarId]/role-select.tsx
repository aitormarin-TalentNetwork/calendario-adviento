"use client";

import type { CalendarRole } from "@/lib/roles";

/**
 * TAL-65 — desplegable de rol de una persona del calendario
 * (design/design-system.md § "Personas del calendario"). Envía su propio
 * <form> (la Server Action `setPersonRoleAction`) al cambiar, sin botón
 * aparte; sin JS, el <noscript> del formulario padre pone un botón
 * "Cambiar". Deshabilitado para el último Admin — el servidor lo rechaza
 * igualmente (`calendarPeople.ts::setPersonRole`).
 */
export function RoleSelect({
  role,
  email,
  disabled,
  describedBy,
}: {
  role: CalendarRole;
  email: string;
  disabled: boolean;
  describedBy?: string;
}) {
  return (
    <select
      name="role"
      defaultValue={role}
      disabled={disabled}
      aria-label={`Rol de ${email}`}
      aria-describedby={describedBy}
      className="people-role"
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      <option value="ADMIN">Administrador</option>
      <option value="GUEST">Visitante</option>
    </select>
  );
}
