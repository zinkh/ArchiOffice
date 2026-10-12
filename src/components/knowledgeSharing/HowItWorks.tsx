/** Le parcours d'un document, dit sans détour : ce qui est lu, ce qui part, ce qui ne part jamais. */
export function HowItWorks({ publicationActive }: { publicationActive: boolean }) {
  const steps = [
    ['Dépôt', 'Vous déposez un document d’un type que vous avez choisi.'],
    ['Lecture', 'Son texte est lu dans ArchiOffice. Le fichier d’origine, son nom, le nom de votre cabinet et ceux de vos clients ne partent jamais.'],
    ['Masquage', 'Les noms, adresses, montants et références connus de votre cabinet sont masqués, puis des règles retirent le reste (téléphones, parcelles, permis...).'],
    ['Relecture IA', 'Mistral, une IA européenne, relit le texte déjà masqué pour repérer ce qui resterait d’identifiant.'],
    ['Tri', 'Tout paragraphe encore douteux est retenu et n’est pas envoyé. Le reste part dans la bibliothèque commune, sans validation manuelle.'],
  ];
  return <details className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
    <summary className="cursor-pointer font-medium">Comment un document est traité</summary>
    <ol className="mt-3 space-y-2">
      {steps.map(([title, text], i) => <li key={title} className="flex gap-3">
        <span aria-hidden className="shrink-0 w-6 h-6 rounded-full border text-xs flex items-center justify-center" style={{ borderColor: 'var(--tblr-border)' }}>{i + 1}</span>
        <span><strong>{title}.</strong> {text}</span>
      </li>)}
    </ol>
    <p className="mt-3" style={{ color: 'var(--tblr-muted)' }}>
      {publicationActive
        ? 'L’envoi est actif sur cette instance.'
        : 'L’envoi est désactivé sur cette instance : tant qu’il l’est, aucun texte n’est analysé ni envoyé, rien ne quitte ArchiOffice.'}
      {' '}Aucune anonymisation automatique n’est parfaite : vous pouvez à tout moment retirer un texte envoyé.
    </p>
  </details>;
}
