/**
 * Spécification OpenAPI 3.0 pour l'API MAF ArchiOffice
 * Version: 1.0.0
 *
 * Cette API expose les données de déclaration MAF et est conçue pour
 * permettre une future intégration avec maf.fr (option Enterprise).
 */
export const MAF_API_SPEC = {
  openapi: '3.0.0',
  info: {
    title: 'ArchiOffice MAF API',
    version: '1.0.0',
    description: 'API de déclaration MAF — Mutuelle des Architectes Français. Gestion des activités professionnelles et calcul des cotisations.',
  },
  servers: [{ url: '/api/maf/v1' }],
  paths: {
    '/config': {
      get: { summary: 'Récupère la config MAF du tenant', tags: ['Config'] },
      put: { summary: 'Met à jour la config MAF du tenant', tags: ['Config'] },
    },
    '/entries': {
      get: {
        summary: 'Liste les entrées de déclaration',
        tags: ['Déclaration'],
        parameters: [
          { name: 'year', in: 'query', required: false, schema: { type: 'integer', default: 2025 } },
          { name: 'intercalaire', in: 'query', required: false, schema: { type: 'string' } },
        ],
      },
      post: { summary: 'Crée une entrée de déclaration', tags: ['Déclaration'] },
    },
    '/entries/{id}': {
      put: { summary: 'Met à jour une entrée', tags: ['Déclaration'] },
      delete: { summary: 'Supprime une entrée', tags: ['Déclaration'] },
    },
    '/summary': {
      get: {
        summary: 'Récapitulatif annuel par intercalaire',
        tags: ['Déclaration'],
        parameters: [
          { name: 'year', in: 'query', required: false, schema: { type: 'integer', default: 2025 } },
        ],
        responses: {
          '200': {
            description: 'Récapitulatif MAF',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    year: { type: 'integer' },
                    numeroAdherent: { type: 'string' },
                    intercalaires: {
                      type: 'object',
                      description: 'Clé = type d\'intercalaire (jaune, vert, violet...)',
                      additionalProperties: {
                        type: 'object',
                        properties: {
                          entries: { type: 'array' },
                          totalAssiette: { type: 'number' },
                          cotisationEstimee: { type: 'number' },
                          tauxPermil: { type: 'number' },
                        },
                      },
                    },
                    cotisationTotaleEstimee: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/export-pdf': {
      get: {
        summary: 'Exporte la déclaration en PDF',
        tags: ['Export'],
        parameters: [
          { name: 'year', in: 'query', required: false, schema: { type: 'integer', default: 2025 } },
        ],
        responses: { '200': { description: 'PDF binaire', content: { 'application/pdf': {} } } },
      },
    },
    '/submit': {
      post: {
        summary: '[Enterprise] Soumet la déclaration à maf.fr',
        tags: ['Automatisation'],
        description: 'Option payante (plan Enterprise). Automatise la saisie sur maf.fr via session authentifiée. Actuellement non implémenté (501).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['year'],
                properties: {
                  year: { type: 'integer', description: 'Année de déclaration' },
                  mafLogin: { type: 'string', description: 'N° adhérent MAF' },
                  mafPassword: { type: 'string', description: 'Mot de passe espace adhérent MAF' },
                },
              },
            },
          },
        },
        responses: {
          '501': { description: 'Non implémenté — disponible avec le plan Enterprise' },
          '200': {
            description: 'Déclaration soumise avec succès',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['success'] },
                    confirmationNumber: { type: 'string' },
                    pdfUrl: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      MafEntry: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          tenantId: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid', nullable: true },
          declarationYear: { type: 'integer' },
          intercalaire: { type: 'string', enum: ['jaune','vert','ami','grand_chantier','violet','orange_clair','orange_fonce','bleu','rose','tabac','gris','puc'] },
          montantCumulFinAnnee: { type: 'number', nullable: true },
          montantCumulAnneePrecedente: { type: 'number', nullable: true },
          honorairesHt: { type: 'number', nullable: true },
          tauxCotisationPermil: { type: 'number', nullable: true },
          notes: { type: 'string', nullable: true },
        },
      },
    },
  },
} as const;
