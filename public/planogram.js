(function () {
  const days = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
  const dateFormat = new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const escapeHtml = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const timeText = minute => `${Math.floor(minute / 60)} h${minute % 60 ? String(minute % 60).padStart(2, "0") : ""}`;
  const dateFor = (weekStart, day) => {
    const date = new Date(`${weekStart}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + day);
    return dateFormat.format(date);
  };
  const slot = enabled => `<td class="${enabled ? "plano-slot" : "plano-off"}">&nbsp;</td><td class="${enabled ? "plano-slot" : "plano-off"}">&nbsp;</td>`;
  const employeeRow = ({ shift, employee }) => {
    const minutes = shift.endMinute - shift.startMinute;
    const pauses = minutes >= 360 ? 2 : minutes >= 180 ? 1 : 0;
    const meal = minutes >= 480;
    return `<tr${employee ? "" : ' class="plano-unfilled"'}><th scope="row" class="plano-name">${employee ? escapeHtml(employee.name) : "&nbsp;"}</th><td class="plano-time">${timeText(shift.startMinute)}</td><td class="plano-time">${timeText(shift.endMinute)}</td>${slot(pauses >= 1)}${slot(meal)}${slot(pauses >= 2)}</tr>`;
  };

  window.createPlanogram = ({ weekStart, shifts, assignments, employees }) => {
    const shiftsById = new Map(shifts.map(shift => [shift.id, shift]));
    const employeesById = new Map(employees.map(employee => [employee.id, employee]));
    const scheduled = assignments.map(assignment => ({
      shift: shiftsById.get(assignment.shiftId),
      employee: employeesById.get(assignment.employeeId),
    })).filter(item => item.shift && item.employee);
    const assignedIds = new Set(scheduled.map(item => item.shift.id));
    const unfilledShifts = shifts.filter(shift => !assignedIds.has(shift.id)).map(shift => ({ shift, employee: null }));
    const groups = [
      { title: "CAISSIÈRES ET SUPERVISEURS", roles: ["cashier", "supervisor"] },
      { title: "EMBALLEURS", roles: ["packer"] },
    ];
    const rowsFor = (day, group) => [...scheduled, ...unfilledShifts]
      .filter(item => item.shift.dayIndex === day && group.roles.includes(item.shift.role))
      .sort((a, b) => a.shift.startMinute - b.shift.startMinute
        || a.shift.endMinute - b.shift.endMinute
        || (a.employee?.name || "").localeCompare(b.employee?.name || "", "fr-CA"));
    const busiestDay = Math.max(...days.map((_, day) => groups.reduce((count, group) => count + rowsFor(day, group).length, 0)));
    const rowHeight = Math.max(31, Math.min(65, Math.floor(850 / Math.max(busiestDay, 1))));
    return days.map((dayName, day) => {
      const sections = groups.map(group => {
        const rows = rowsFor(day, group);
        return `<tr class="plano-group"><th colspan="9">${group.title}</th></tr>${rows.map(employeeRow).join("") || '<tr class="plano-empty"><td colspan="9">Aucun employé prévu</td></tr>'}`;
      }).join("");
      return `<article class="plano-page" style="--plano-row-height:${rowHeight}px"><header class="plano-title"><div><p>IGA EXTRA FAMILLE BENOIT</p><h1>Feuille de route · ${dayName}</h1></div><div><b>${dateFor(weekStart, day)}</b><small>Pauses à noter par le superviseur</small></div></header><table class="plano-table"><thead><tr><th rowspan="2">Employé</th><th rowspan="2">Entrée</th><th rowspan="2">Sortie</th><th colspan="2">Pause 1</th><th colspan="2">Repas</th><th colspan="2">Pause 2</th></tr><tr><th>Sortie</th><th>Retour</th><th>Sortie</th><th>Retour</th><th>Sortie</th><th>Retour</th></tr></thead><tbody>${sections}</tbody></table><footer class="plano-footer">Semaine du ${dateFor(weekStart, 0)} · ${dayName}</footer></article>`;
    }).join("");
  };
})();
