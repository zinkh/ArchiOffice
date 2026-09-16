import i18n from '../i18n';

export const generateWordDoc = (data: any) => {
  console.log('Generating Word doc:', data);
  alert(i18n.t('document_service_word_not_implemented'));
};

export const generateExcelDoc = (data: any) => {
  console.log('Generating Excel doc:', data);
  alert(i18n.t('document_service_excel_not_implemented'));
};
