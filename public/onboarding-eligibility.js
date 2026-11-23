// The invitation identifies the employee by their stable record key, not by payroll code.
export const matriculePending=employee=>employee.issue==='Matricule manquant : à attribuer dans la liste du personnel';
export const onboardingBlockReason=employee=>!employee.active
 ?'Cette fiche est inactive. Réactivez l’employé avant de transmettre ses documents.'
 :employee.issue&&!matriculePending(employee)
  ?'Le rapprochement de cette fiche doit être corrigé : '+employee.issue+'.'
  :null;
