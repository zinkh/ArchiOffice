import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { Proposal } from '../types';

// Map Proposal fields to XML DBKey and UIKey
const fieldMapping: { [key in keyof Proposal]?: { dbKey: string; uiKey: string } } = {
  title: { dbKey: 'PROJECTNAME', uiKey: 'Nom du projet' },
  description: { dbKey: 'PROJECT_DESCRIPTION', uiKey: 'Description du Projet' },
  // Add other fields here...
  project_code: { dbKey: 'PROJECT_CODE', uiKey: 'Code du Projet' },
  project_number: { dbKey: 'PROJECTNUMBER', uiKey: 'Numéro du Projet' },
  project_status: { dbKey: 'PROJECTSTATUS', uiKey: 'État du Projet' },
  keywords: { dbKey: 'KEYWORDS', uiKey: 'Mots-clés' },
  notes: { dbKey: 'NOTES', uiKey: 'Notes' },
  site_name: { dbKey: 'SITE_NAME', uiKey: 'Nom du site' },
  site_description: { dbKey: 'SITE_DESCRIPTION', uiKey: 'Description du site' },
  site_id: { dbKey: 'SITE_ID', uiKey: 'ID du site' },
  site_address_1: { dbKey: 'SITE_ADDRESS_1', uiKey: 'Adresse du site 1' },
  site_address_2: { dbKey: 'SITE_ADDRESS_2', uiKey: 'Adresse du site 2' },
  site_address_3: { dbKey: 'SITE_ADDRESS_3', uiKey: 'Adresse du site 3' },
  site_postbox: { dbKey: 'SITE_POSTBOX', uiKey: 'Boîte postale du site' },
  site_city: { dbKey: 'SITE_CITY', uiKey: 'Ville du site' },
  site_state: { dbKey: 'SITE_STATE', uiKey: 'État du site' },
  site_postcode: { dbKey: 'SITE_POSTCODE', uiKey: 'Code postal du site' },
  site_country: { dbKey: 'SITE_COUNTRY', uiKey: 'Pays du site' },
  site_gross_perimeter: { dbKey: 'SITE_GROSS_PERIMETER', uiKey: 'Périmètre brut du site' },
  site_gross_area: { dbKey: 'SITE_GROSS_AREA', uiKey: 'Surface brute du site' },
  building_name: { dbKey: 'BUILDING_NAME', uiKey: 'Nom du bâtiment' },
  building_description: { dbKey: 'BUILDING_DESCRIPTION', uiKey: 'Description du bâtiment' },
  building_id: { dbKey: 'BUILDING_ID', uiKey: 'ID du bâtiment' },
  contact_fullname: { dbKey: 'CONTACT_FULLNAME', uiKey: 'Nom complet du contact' },
  contact_prefixtitle: { dbKey: 'CONTACT_PREFIXTITLE', uiKey: 'Titre du contact' },
  contact_givenname: { dbKey: 'CONTACT_GIVENNAME', uiKey: 'Prénom du contact' },
  contact_middlename: { dbKey: 'CONTACT_MIDDLENAME', uiKey: 'Deuxième prénom du contact' },
  contact_familyname: { dbKey: 'CONTACT_FAMILYNAME', uiKey: 'Nom de famille du contact' },
  contact_suffixtitle: { dbKey: 'CONTACT_SUFFIXTITLE', uiKey: 'Suffixe du contact' },
  contact_nameorder: { dbKey: 'CONTACT_NAMEORDER', uiKey: 'Ordre du nom du contact' },
  contact_id: { dbKey: 'CONTACT_ID', uiKey: 'ID du contact' },
  contact_role: { dbKey: 'CONTACT_ROLE', uiKey: 'Rôle du contact' },
  contact_department: { dbKey: 'CONTACT_DEPARTMENT', uiKey: 'Département du contact' },
  contact_company: { dbKey: 'CONTACT_COMPANY', uiKey: 'Entreprise du contact' },
  contact_companycode: { dbKey: 'CONTACT_COMPANYCODE', uiKey: 'Code entreprise du contact' },
  contact_fulladdress: { dbKey: 'CONTACT_FULLADDRESS', uiKey: 'Adresse complète du contact' },
  contact_address_1: { dbKey: 'CONTACT_ADDRESS_1', uiKey: 'Adresse du contact 1' },
  contact_address_2: { dbKey: 'CONTACT_ADDRESS_2', uiKey: 'Adresse du contact 2' },
  contact_address_3: { dbKey: 'CONTACT_ADDRESS_3', uiKey: 'Adresse du contact 3' },
  contact_postbox: { dbKey: 'CONTACT_POSTBOX', uiKey: 'Boîte postale du contact' },
  contact_city: { dbKey: 'CONTACT_CITY', uiKey: 'Ville du contact' },
  contact_state: { dbKey: 'CONTACT_STATE', uiKey: 'État du contact' },
  contact_postcode: { dbKey: 'CONTACT_POSTCODE', uiKey: 'Code postal du contact' },
  contact_country: { dbKey: 'CONTACT_COUNTRY', uiKey: 'Pays du contact' },
  contact_email: { dbKey: 'CONTACT_EMAIL', uiKey: 'Email du contact' },
  contact_phone: { dbKey: 'CONTACT_PHONE', uiKey: 'Téléphone du contact' },
  contact_fax: { dbKey: 'CONTACT_FAX', uiKey: 'Fax du contact' },
  contact_web: { dbKey: 'CONTACT_WEB', uiKey: 'Site web du contact' },
  cad_technician_fullname: { dbKey: 'CAD_TECHNICIAN_FULLNAME', uiKey: 'Nom complet du technicien CAD' },
  cad_technician_prefixtitle: { dbKey: 'CAD_TECHNICIAN_PREFIXTITLE', uiKey: 'Titre du technicien CAD' },
  cad_technician_givenname: { dbKey: 'CAD_TECHNICIAN_GIVENNAME', uiKey: 'Prénom du technicien CAD' },
  cad_technician_middlename: { dbKey: 'CAD_TECHNICIAN_MIDDLENAME', uiKey: 'Deuxième prénom du technicien CAD' },
  cad_technician_familyname: { dbKey: 'CAD_TECHNICIAN_FAMILYNAME', uiKey: 'Nom de famille du technicien CAD' },
  cad_technician_suffixtitle: { dbKey: 'CAD_TECHNICIAN_SUFFIXTITLE', uiKey: 'Suffixe du technicien CAD' },
  cad_technician_nameorder: { dbKey: 'CAD_TECHNICIAN_NAMEORDER', uiKey: 'Ordre du nom du technicien CAD' },
  client_fullname: { dbKey: 'CLIENT_FULLNAME', uiKey: 'Nom complet du client' },
  client_prefixtitle: { dbKey: 'CLIENT_PREFIXTITLE', uiKey: 'Titre du client' },
  client_givenname: { dbKey: 'CLIENT_GIVENNAME', uiKey: 'Prénom du client' },
  client_middlename: { dbKey: 'CLIENT_MIDDLENAME', uiKey: 'Deuxième prénom du client' },
  client_familyname: { dbKey: 'CLIENT_FAMILYNAME', uiKey: 'Nom de famille du client' },
  client_suffixtitle: { dbKey: 'CLIENT_SUFFIXTITLE', uiKey: 'Suffixe du client' },
  client_nameorder: { dbKey: 'CLIENT_NAMEORDER', uiKey: 'Ordre du nom du client' },
  client_company: { dbKey: 'CLIENT_COMPANY', uiKey: 'Entreprise du client' },
  client_fulladdress: { dbKey: 'CLIENT_FULLADDRESS', uiKey: 'Adresse complète du client' },
  client_address_1: { dbKey: 'CLIENT_ADDRESS_1', uiKey: 'Adresse du client 1' },
  client_address_2: { dbKey: 'CLIENT_ADDRESS_2', uiKey: 'Adresse du client 2' },
  client_address_3: { dbKey: 'CLIENT_ADDRESS_3', uiKey: 'Adresse du client 3' },
  client_postbox: { dbKey: 'CLIENT_POSTBOX', uiKey: 'Boîte postale du client' },
  client_city: { dbKey: 'CLIENT_CITY', uiKey: 'Ville du client' },
  client_state: { dbKey: 'CLIENT_STATE', uiKey: 'État du client' },
  client_postcode: { dbKey: 'CLIENT_POSTCODE', uiKey: 'Code postal du client' },
  client_country: { dbKey: 'CLIENT_COUNTRY', uiKey: 'Pays du client' },
  client_email: { dbKey: 'CLIENT_EMAIL', uiKey: 'Email du client' },
  client_phone: { dbKey: 'CLIENT_PHONE', uiKey: 'Téléphone du client' },
  client_fax: { dbKey: 'CLIENT_FAX', uiKey: 'Fax du client' },
  ed_report_header: { dbKey: 'ED_REPORT_HEADER', uiKey: 'En-tête du rapport ED' },
  custom_building: { dbKey: 'CUSTOM_BUILDING', uiKey: 'Bâtiment personnalisé' },
  custom_architect: { dbKey: 'CUSTOM_ARCHITECT', uiKey: 'Architecte personnalisé' },
  custom_client: { dbKey: 'CUSTOM_CLIENT', uiKey: 'Client personnalisé' },
};

export function proposalToXml(proposal: Proposal): string {
  const fixKeys: any[] = [];
  let i = 1;
  
  for (const [key, value] of Object.entries(proposal)) {
    const mapping = fieldMapping[key as keyof Proposal];
    if (mapping) {
      fixKeys.push({
        [`Fix${i}`]: {
          UIKey: mapping.uiKey,
          DBKey: mapping.dbKey,
          value: value
        }
      });
      i++;
    }
  }

  const xmlObj = {
    ProjectInfo: {
      Version: { '@_val': '3' },
      FixKeys: {
        '@_val': (i - 1).toString(),
        ...Object.assign({}, ...fixKeys)
      }
    }
  };

  const builder = new XMLBuilder({ ignoreAttributes: false });
  return builder.build(xmlObj);
}

export function xmlToProposal(xml: string): Partial<Proposal> {
  const parser = new XMLParser({ ignoreAttributes: false });
  const jsonObj = parser.parse(xml);
  
  const proposal: Partial<Proposal> = {};
  const fixKeys = jsonObj.ProjectInfo.FixKeys;
  
  // Handle the case where FixKeys might be an object with Fix1, Fix2, etc.
  for (const key in fixKeys) {
    if (key.startsWith('Fix')) {
      const fix = fixKeys[key];
      const dbKey = fix.DBKey;
      const value = fix.value;
      
      // Find the field mapping
      for (const [propKey, mapping] of Object.entries(fieldMapping)) {
        if (mapping.dbKey === dbKey) {
          (proposal as any)[propKey] = value;
          break;
        }
      }
    }
  }
  
  return proposal;
}
