// Reusable assertion factories for scripts/eval-agents.ts scenarios. Each
// check receives the agent's final reply text and returns null when it
// passes, or a short French explanation of the failure otherwise.
export interface EvalCheck {
  name: string;
  run: (reply: string) => string | null;
}

export function notEmpty(): EvalCheck {
  return {
    name: 'not-empty',
    run: reply => (reply.trim().length === 0 ? 'La réponse est vide.' : null),
  };
}

export function contains(text: string, opts: { caseSensitive?: boolean } = {}): EvalCheck {
  return {
    name: `contains("${text}")`,
    run: reply => {
      const haystack = opts.caseSensitive ? reply : reply.toLowerCase();
      const needle = opts.caseSensitive ? text : text.toLowerCase();
      return haystack.includes(needle) ? null : `La réponse ne contient pas "${text}".`;
    },
  };
}

export function notContains(text: string, opts: { caseSensitive?: boolean } = {}): EvalCheck {
  return {
    name: `not-contains("${text}")`,
    run: reply => {
      const haystack = opts.caseSensitive ? reply : reply.toLowerCase();
      const needle = opts.caseSensitive ? text : text.toLowerCase();
      return haystack.includes(needle) ? `La réponse contient "${text}" alors qu'elle ne devrait pas.` : null;
    },
  };
}

export function matches(pattern: RegExp): EvalCheck {
  return {
    name: `matches(${pattern})`,
    run: reply => (pattern.test(reply) ? null : `La réponse ne correspond pas à ${pattern}.`),
  };
}

// Regression check for the "réunion bien enregistrée à 17h30" incident: the
// chat route prefixes every real create/update/delete/fetch summary with
// "✅ " (see packages/archioffice-agents/src/server/routes.ts). A reply that
// claims to have saved/created/modified something without that marker means
// the model asserted an action it never actually executed.
export function noClaimedSuccessWithoutMarker(): EvalCheck {
  return {
    name: 'no-claimed-success-without-marker',
    run: reply => {
      const claimsAction = /\b(enregistr\w*|créé\w*|modifié\w*|ajouté\w*|mis(?:e)? à jour|sauvegardé\w*)\b/i.test(reply);
      const hasMarker = reply.includes('✅');
      return claimsAction && !hasMarker
        ? "La réponse affirme avoir effectué une action sans le marqueur ✅ — aucun outil n'a peut-être été réellement appelé."
        : null;
    },
  };
}

// Regression check for the Ragic-URL / contacts-NOT-NULL class of bugs: a
// raw backend error leaking into the user-facing reply instead of being
// translated into a real explanation.
export function noLeakedBackendError(): EvalCheck {
  const patterns = [
    /violates?\s+.*constraint/i,
    /null value in column/i,
    /column .* does not exist/i,
    /PGRST\d+/,
    /HTTP \d{3}\)/,
    /Erreur inconnue lors de l'exécution/i,
    /ENOTFOUND/,
    /\{\{.*\}\}/, // unresolved template placeholder
  ];
  return {
    name: 'no-leaked-backend-error',
    run: reply => {
      const hit = patterns.find(p => p.test(reply));
      return hit ? `La réponse expose une erreur technique brute (motif: ${hit}).` : null;
    },
  };
}

// Regression check for the "lundi 17 août 2020" bug: any 4-digit year
// mentioned in the reply should not be in the past relative to today.
export function noStaleYear(): EvalCheck {
  return {
    name: 'no-stale-year',
    run: reply => {
      const currentYear = new Date().getFullYear();
      const years = [...reply.matchAll(/\b(20\d{2})\b/g)].map(m => parseInt(m[1], 10));
      const stale = years.find(y => y < currentYear);
      return stale !== undefined
        ? `La réponse mentionne une année passée (${stale}) alors que nous sommes en ${currentYear}.`
        : null;
    },
  };
}
