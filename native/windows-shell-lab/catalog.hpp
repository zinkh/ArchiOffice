#pragma once
#include <windows.h>
#include <roapi.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <map>
#include <string>
#include <vector>
#include <stdexcept>
#include <cmath>

namespace archioffice {
using namespace winrt::Windows::Data::Json;
struct CaseInsensitive { bool operator()(const std::wstring& a,const std::wstring& b) const { return _wcsicmp(a.c_str(),b.c_str())<0; } };
struct CatalogDocument { std::wstring properties; };
using Catalog=std::map<std::wstring,CatalogDocument,CaseInsensitive>;
inline double nowMilliseconds() { FILETIME time{};GetSystemTimeAsFileTime(&time);ULARGE_INTEGER n{};n.LowPart=time.dwLowDateTime;n.HighPart=time.dwHighDateTime;return static_cast<double>((n.QuadPart-116444736000000000ULL)/10000ULL); }
inline std::wstring plain(const JsonObject& object,const wchar_t* key,size_t max=512) {
 auto value=object.GetNamedValue(key);if(value.ValueType()==JsonValueType::Null)return L"Non renseigné";
 auto text=std::wstring(value.GetString());if(text.size()>max||text.find_first_of(L"\r\n\t")!=std::wstring::npos||text.find(L'\0')!=std::wstring::npos)throw std::runtime_error("Invalid text");return text;
}
inline std::wstring version(const JsonObject& object,const wchar_t* key) {
 double n=object.GetNamedNumber(key);if(!std::isfinite(n)||n<1||n>9007199254740991.0||n!=std::floor(n))throw std::runtime_error("Invalid version");return std::to_wstring(static_cast<ULONGLONG>(n));
}
inline std::wstring label(const std::wstring& code,const std::map<std::wstring,std::wstring>& labels) {
 auto found=labels.find(code);return found==labels.end()?code:found->second;
}
inline Catalog parseCatalog(const std::wstring& json,const std::wstring& root,double now) {
 const auto data=JsonObject::Parse(json);
 if(data.GetNamedNumber(L"schema")!=1||_wcsicmp(data.GetNamedString(L"namespace").c_str(),root.c_str())!=0
   ||data.GetNamedString(L"identityKey")!=root.substr(root.size()-64))throw std::runtime_error("Wrong namespace");
 double lease=data.GetNamedNumber(L"expiresAt");if(!(lease>now&&lease<=now+30000))throw std::runtime_error("Expired display lease");
 auto projects=data.GetNamedArray(L"projects");if(projects.Size()>10)throw std::runtime_error("Project limit");
 std::map<std::wstring,std::wstring> names;
 for(auto value:projects) {auto p=value.GetObject();auto id=std::wstring(p.GetNamedString(L"projectId"));if(!names.emplace(id,plain(p,L"name")).second)throw std::runtime_error("Duplicate project");}
 auto documents=data.GetNamedArray(L"documents");if(documents.Size()>1000)throw std::runtime_error("Document limit");Catalog result;
 for(auto value:documents) {
  auto d=value.GetObject();std::wstring relative=d.GetNamedString(L"relativePath").c_str(),project=d.GetNamedString(L"projectId").c_str();
  if(relative.empty()||relative.size()>300||relative.front()!=L'_'||relative.find_first_of(L"/:\r\n")!=std::wstring::npos||!names.count(project))throw std::runtime_error("Invalid path");
  size_t start=0;
  do{auto end=relative.find(L'\\',start);auto segment=relative.substr(start,end==std::wstring::npos?end:end-start);
    if(segment.empty()||segment==L"."||segment==L".."||segment.front()!=L'_')throw std::runtime_error("Invalid path segment");
    if(end==std::wstring::npos)break;start=end+1;
  }while(true);
  std::wstring info=L"Projet\r\n"+names.at(project)+L"\r\n\r\nVersion du catalogue A:\r\n"+version(d,L"catalogVersion");
  auto business=d.GetNamedValue(L"business");
  if(business.ValueType()==JsonValueType::Object) {
   auto b=business.GetObject();
   if(b.GetNamedString(L"projectId")!=project||b.GetNamedString(L"nodeId")!=d.GetNamedString(L"nodeId"))throw std::runtime_error("Wrong document");
   info+=L"\r\n\r\nNom dans ArchiOffice\r\n"+plain(b,L"name");
   info+=L"\r\n\r\nPhase\r\n"+plain(b,L"phase",200)+L"\r\n\r\nType documentaire\r\n"+plain(b,L"documentType",200);
   info+=L"\r\n\r\nIndice métier\r\n"+plain(b,L"indice",200)+L"\r\n\r\nVersion distante observée\r\n"+version(b,L"remoteVersion");
   info+=L"\r\n\r\nStatut métier\r\n"+label(plain(b,L"status",200),{{L"en_cours",L"En cours"},{L"approuve",L"Approuvé"},{L"perime",L"Périmé"}});
   auto permissions=b.GetNamedObject(L"permissions");if(!permissions.GetNamedBoolean(L"read"))throw std::runtime_error("Read denied");
   info+=L"\r\n\r\nModification autorisée par le serveur\r\n"+std::wstring(permissions.GetNamedBoolean(L"write")?L"Oui":L"Non");
   info+=L"\r\nMotif de lecture seule\r\n"+label(plain(b,L"readOnlyReason",200),{{L"approved",L"Document approuvé"},{L"archived",L"Projet archivé"},{L"locked",L"Verrouillé par une autre personne"},{L"role",L"Droits du cabinet"}});
   double observed=d.GetNamedNumber(L"observedAt");if(!(observed>0&&observed<=now))throw std::runtime_error("Invalid observation");
   ULARGE_INTEGER stamp{};stamp.QuadPart=static_cast<ULONGLONG>(observed)*10000ULL+116444736000000000ULL;
   FILETIME utc{stamp.LowPart,stamp.HighPart},local{};SYSTEMTIME system{};wchar_t date[80]{},time[80]{};
   if(FileTimeToLocalFileTime(&utc,&local)&&FileTimeToSystemTime(&local,&system)) {
    GetDateFormatEx(LOCALE_NAME_USER_DEFAULT,DATE_SHORTDATE,&system,nullptr,date,80,nullptr);GetTimeFormatEx(LOCALE_NAME_USER_DEFAULT,TIME_NOSECONDS,&system,nullptr,time,80);
    info+=L"\r\n\r\nMétadonnées observées le\r\n"+std::wstring(date)+L" "+time;
   }
   if(d.GetNamedBoolean(L"stale"))info+=L"\r\nInformations en cache, actualisation distante indisponible ou en attente.";
  } else if(business.ValueType()==JsonValueType::Null)info+=L"\r\n\r\nMétadonnées métier indisponibles.";
  else throw std::runtime_error("Invalid business metadata");
  auto state=d.GetNamedValue(L"transferState");std::wstring transfer=L"Indisponible";
  if(state.ValueType()==JsonValueType::String) {
   auto code=std::wstring(state.GetString());
   static const std::map<std::wstring,std::wstring> labels={{L"none",L"Aucun envoi suivi"},{L"queued",L"En attente"},{L"uploading",L"Envoi en cours"},{L"retry",L"Nouvelle tentative prévue"},{L"blocked",L"Envoi bloqué"},{L"conflict",L"Conflit"},{L"uploaded",L"Dernier envoi accepté"},{L"reconciled",L"Reprise distante effectuée"}};
   auto found=labels.find(code);if(found==labels.end())throw std::runtime_error("Unknown transfer state");transfer=found->second;
  }else if(state.ValueType()!=JsonValueType::Null)throw std::runtime_error("Invalid transfer state");
  info+=L"\r\n\r\nÉtat d’envoi\r\n"+transfer+L"\r\nCet état ne garantit pas l’absence de modifications locales plus récentes.";
  if(!result.emplace(relative,CatalogDocument{info}).second)throw std::runtime_error("Duplicate path");
 }
 return result;
}
inline Catalog readCatalog(const std::wstring& root) {
 HANDLE file=CreateFileW((root+L".shell.json").c_str(),GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
 if(file==INVALID_HANDLE_VALUE)return {};
 BY_HANDLE_FILE_INFORMATION attributes{};LARGE_INTEGER size{};DWORD bytes=0;std::string json;
 bool valid=GetFileInformationByHandle(file,&attributes)&&!(attributes.dwFileAttributes&(FILE_ATTRIBUTE_REPARSE_POINT|FILE_ATTRIBUTE_DIRECTORY))&&GetFileSizeEx(file,&size)&&size.QuadPart>0&&size.QuadPart<=8*1024*1024;
 if(valid){json.resize(static_cast<size_t>(size.QuadPart));valid=ReadFile(file,json.data(),static_cast<DWORD>(json.size()),&bytes,nullptr)&&bytes==json.size();}
 CloseHandle(file);if(!valid)return {};
 HRESULT initialized=RoInitialize(RO_INIT_SINGLETHREADED);Catalog result;
 try {result=parseCatalog(std::wstring(winrt::to_hstring(json)),root,nowMilliseconds());}catch(...){}
 if(SUCCEEDED(initialized))RoUninitialize();return result;
}
}
