#include "shell.hpp"
#include <chrono>
#include <algorithm>
#include <stdexcept>
#include <wincrypt.h>
using namespace winrt::Windows::Data::Json;
namespace {
struct Handle {HANDLE value=INVALID_HANDLE_VALUE;~Handle(){if(value!=INVALID_HANDLE_VALUE)CloseHandle(value);}};
std::wstring setting(wchar_t const* name){wchar_t value[512];DWORD size=sizeof(value);if(RegGetValueW(HKEY_CURRENT_USER,RuntimeKey,name,RRF_RT_REG_SZ,nullptr,value,&size)!=ERROR_SUCCESS)throw std::runtime_error("client unavailable");return value;}
bool valid(std::wstring const& s,size_t max){return !s.empty()&&s.size()<=max;}
void transfer(HANDLE pipe,bool write,char* bytes,DWORD size,DWORD& count,ULONGLONG deadline,std::atomic<bool>* cancelled){
 Handle event;event.value=CreateEventW(nullptr,TRUE,FALSE,nullptr);if(!event.value)throw std::runtime_error("event");OVERLAPPED op{};op.hEvent=event.value;
 BOOL ready=write?WriteFile(pipe,bytes,size,&count,&op):ReadFile(pipe,bytes,size,&count,&op);
 if(!ready){if(GetLastError()!=ERROR_IO_PENDING)throw std::runtime_error("pipe");auto now=GetTickCount64();DWORD remaining=now<deadline?static_cast<DWORD>(deadline-now):0;
  DWORD waited=WAIT_TIMEOUT;while(remaining&&!(cancelled&&*cancelled)){waited=WaitForSingleObject(event.value,std::min<DWORD>(remaining,100));if(waited!=WAIT_TIMEOUT)break;auto tick=GetTickCount64();remaining=tick<deadline?static_cast<DWORD>(deadline-tick):0;}
  if(waited!=WAIT_OBJECT_0||cancelled&&*cancelled){CancelIoEx(pipe,&op);GetOverlappedResult(pipe,&op,&count,TRUE);throw std::runtime_error("timeout");}
  if(!GetOverlappedResult(pipe,&op,&count,FALSE))throw std::runtime_error("pipe");
 }
}
std::wstring observedDate(double n){
 if(n<1||n>32503680000000.0)throw std::runtime_error("history date");ULARGE_INTEGER stamp{};stamp.QuadPart=static_cast<ULONGLONG>(n)*10000ULL+116444736000000000ULL;FILETIME utc{stamp.LowPart,stamp.HighPart},local{};SYSTEMTIME time{};wchar_t date[80]{},hour[80]{};
 if(!FileTimeToLocalFileTime(&utc,&local)||!FileTimeToSystemTime(&local,&time))throw std::runtime_error("history date");GetDateFormatEx(LOCALE_NAME_USER_DEFAULT,DATE_SHORTDATE,&time,nullptr,date,80,nullptr);GetTimeFormatEx(LOCALE_NAME_USER_DEFAULT,TIME_NOSECONDS,&time,nullptr,hour,80);return std::wstring(date)+L" "+hour;
}
std::wstring field(JsonObject const& value,wchar_t const* name,size_t limit){auto s=std::wstring(value.GetNamedString(name));if(s.size()>limit)throw std::runtime_error("field");return s;}
}
Reply request(std::wstring action,std::wstring project,std::wstring key,std::wstring revision,int page,std::atomic<bool>* cancelled,std::wstring phase,std::wstring type,int baseVersion){
 Reply reply;try{
  auto address=setting(L"Pipe"),token=setting(L"Token");std::wstring prefix=L"\\\\.\\pipe\\ArchiOffice.DriveShell.";
  if(!address.starts_with(prefix)||address.size()!=prefix.size()+36||address.substr(prefix.size()).find_first_not_of(L"0123456789abcdef-")!=std::wstring::npos||token.size()!=64||token.find_first_not_of(L"0123456789abcdef")!=std::wstring::npos)throw std::runtime_error("endpoint");
  if(!WaitNamedPipeW(address.c_str(),500))throw std::runtime_error("client unavailable");Handle pipe;
  pipe.value=CreateFileW(address.c_str(),GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,FILE_FLAG_OVERLAPPED|SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION,nullptr);
  if(pipe.value==INVALID_HANDLE_VALUE)throw std::runtime_error("client unavailable");
  JsonObject input;input.SetNamedValue(L"format",JsonValue::CreateNumberValue(1));input.SetNamedValue(L"token",JsonValue::CreateStringValue(token));input.SetNamedValue(L"action",JsonValue::CreateStringValue(action));
  input.SetNamedValue(L"projectId",JsonValue::CreateStringValue(project));input.SetNamedValue(L"key",JsonValue::CreateStringValue(key));input.SetNamedValue(L"revision",JsonValue::CreateStringValue(revision));
  input.SetNamedValue(L"page",JsonValue::CreateNumberValue(page));
  if(action==L"classify"){input.SetNamedValue(L"phase",JsonValue::CreateStringValue(phase));input.SetNamedValue(L"docType",JsonValue::CreateStringValue(type));input.SetNamedValue(L"baseVersion",JsonValue::CreateNumberValue(baseVersion));}
  auto data=winrt::to_string(input.Stringify())+"\n";auto deadline=GetTickCount64()+(action==L"preview"?20000:action==L"versions"?12000:action==L"catalog"||action==L"open"||action==L"document"?5000:300000);DWORD count=0;transfer(pipe.value,true,data.data(),static_cast<DWORD>(data.size()),count,deadline,cancelled);if(count!=data.size())throw std::runtime_error("write");
  std::string response;char buffer[16384];while(response.find('\n')==std::string::npos){transfer(pipe.value,false,buffer,sizeof(buffer),count,deadline,cancelled);if(!count)throw std::runtime_error("eof");response.append(buffer,count);if(response.size()>(action==L"catalog"?64*1024*1024:2*1024*1024))throw std::runtime_error("response size");}
  auto value=JsonObject::Parse(winrt::to_hstring(response.substr(0,response.find('\n'))));auto status=value.GetNamedString(L"status");
  if(action==L"actions"){if(status!=L"actions"){reply.message=std::wstring(value.GetNamedString(L"message",L"Actions indisponibles."));return reply;}reply.phase=field(value,L"phase",60);reply.docType=field(value,L"docType",60);reply.version=static_cast<int>(value.GetNamedNumber(L"version"));reply.writable=value.GetNamedBoolean(L"writable");reply.message=field(value,L"reason",200);reply.ok=true;return reply;}
  if(status==L"completed"){reply.ok=true;reply.message=field(value,L"message",512);return reply;}
  if(status==L"unavailable"){reply.message=std::wstring(value.GetNamedString(L"message",L"Action indisponible. Actualisez puis réessayez."));return reply;}
  if(action==L"preview"){
   if(status!=L"preview"){reply.message=status==L"unsupported"?L"Aperçu indisponible pour ce format. Utilisez Ouvrir pour son logiciel habituel.":L"Aperçu indisponible. Vérifiez le fichier et la connexion, puis réessayez.";return reply;}
   auto number=[&](wchar_t const* key,int max){double n=value.GetNamedNumber(key);if(n<0||n>max||n!=static_cast<int>(n))throw std::runtime_error("preview bounds");return static_cast<int>(n);};
   reply.width=number(L"width",512);reply.height=number(L"height",640);reply.pages=number(L"pages",10000);reply.page=number(L"page",9999);
   if(!reply.width||!reply.height||!reply.pages||reply.page>=reply.pages)throw std::runtime_error("preview dimensions");auto pixels=field(value,L"pixels",1800000);DWORD bytes=0;
   if(!CryptStringToBinaryW(pixels.c_str(),static_cast<DWORD>(pixels.size()),CRYPT_STRING_BASE64,nullptr,&bytes,nullptr,nullptr)||bytes!=static_cast<DWORD>(reply.width*reply.height*4))throw std::runtime_error("preview pixels");reply.pixels.resize(bytes);
   if(!CryptStringToBinaryW(pixels.c_str(),static_cast<DWORD>(pixels.size()),CRYPT_STRING_BASE64,reply.pixels.data(),&bytes,nullptr,nullptr))throw std::runtime_error("preview pixels");reply.ok=true;return reply;
  }
  if(action==L"versions"){
   if(status!=L"versions"){reply.message=L"Historique indisponible. Vérifiez la connexion et les droits, puis réessayez.";return reply;}
   auto rows=value.GetNamedArray(L"versions");double total=value.GetNamedNumber(L"total");if(rows.Size()>50||total<rows.Size()||total>10000)throw std::runtime_error("history bounds");
   reply.history=L"Historique observé le "+observedDate(value.GetNamedNumber(L"observedAt"))+L"\r\n"+std::to_wstring(rows.Size())+L" version(s) sur "+std::to_wstring(static_cast<int>(total))+L"\r\n";
   if(value.GetNamedBoolean(L"stale"))reply.history+=L"Historique en cache, actualisation distante indisponible.\r\n";
   if(!rows.Size())reply.history+=L"Aucune version historique disponible.";
   for(auto const& row:rows){auto v=row.GetObject();double version=v.GetNamedNumber(L"version");if(version<1||version>2147483647||version!=static_cast<int>(version))throw std::runtime_error("history version");reply.history+=L"\r\nVersion "+std::to_wstring(static_cast<int>(version));
    auto date=v.GetNamedValue(L"uploadedAt"),size=v.GetNamedValue(L"size"),description=v.GetNamedValue(L"description");
    if(date.ValueType()==JsonValueType::String)reply.history+=L"\r\n"+field(v,L"uploadedAt",80);
    if(size.ValueType()==JsonValueType::Number)reply.history+=L"\r\n"+std::to_wstring(static_cast<ULONGLONG>(size.GetNumber()))+L" octets";
    if(description.ValueType()==JsonValueType::String)reply.history+=L"\r\n"+field(v,L"description",512);reply.history+=L"\r\n";
   }reply.ok=true;return reply;
  }
  if(action!=L"catalog"){reply.ok=status==L"opened";reply.message=reply.ok?L"Document ouvert.":L"Ouverture indisponible. Actualisez le catalogue et vérifiez les droits Drive.";return reply;}
  if(status!=L"ok")throw std::runtime_error("access refused");reply.scope=field(value,L"scope",64);if(reply.scope.size()!=64||reply.scope.find_first_not_of(L"0123456789abcdef")!=std::wstring::npos)throw std::runtime_error("scope");auto projects=value.GetNamedArray(L"projects");if(projects.Size()>10)throw std::runtime_error("projects");
  for(auto const& item:projects){auto p=item.GetObject();Project entry;entry.id=field(p,L"id",200);entry.name=field(p,L"name",240);entry.revision=field(p,L"revision",64);auto rows=p.GetNamedArray(L"rows");if(!valid(entry.id,200)||entry.revision.size()!=64)throw std::runtime_error("catalog");
   for(auto const& itemRow:rows){auto d=itemRow.GetObject();Document doc;doc.key=field(d,L"key",64);doc.name=field(d,L"name",512);doc.phase=field(d,L"phase",120);doc.type=field(d,L"type",200);doc.fileType=field(d,L"fileType",20);doc.indice=field(d,L"indice",200);doc.status=field(d,L"status",200);doc.transferState=field(d,L"transferState",40);
    doc.errorCode=std::wstring(d.GetNamedString(L"errorCode",L""));doc.preservation=std::wstring(d.GetNamedString(L"preservation",L""));doc.readOnlyReason=std::wstring(d.GetNamedString(L"readOnlyReason",L""));doc.writable=d.GetNamedBoolean(L"writable",false);
    doc.metadataStale=d.GetNamedBoolean(L"metadataStale");auto observed=d.GetNamedValue(L"observedAt");
    if(observed.ValueType()==JsonValueType::Number){double n=observed.GetNumber();if(n<1||n>9007199254740991.0)throw std::runtime_error("metadata date");ULARGE_INTEGER stamp{};stamp.QuadPart=static_cast<ULONGLONG>(n)*10000ULL+116444736000000000ULL;FILETIME utc{stamp.LowPart,stamp.HighPart},local{};SYSTEMTIME time{};wchar_t date[80]{},hour[80]{};if(FileTimeToLocalFileTime(&utc,&local)&&FileTimeToSystemTime(&local,&time)){GetDateFormatEx(LOCALE_NAME_USER_DEFAULT,DATE_SHORTDATE,&time,nullptr,date,80,nullptr);GetTimeFormatEx(LOCALE_NAME_USER_DEFAULT,TIME_NOSECONDS,&time,nullptr,hour,80);doc.metadataDate=std::wstring(date)+L" "+hour;}}
    else if(observed.ValueType()!=JsonValueType::Null)throw std::runtime_error("metadata date");
    doc.businessKnown=d.GetNamedBoolean(L"businessKnown");doc.unclassified=d.GetNamedBoolean(L"unclassified");auto available=d.GetNamedValue(L"available");if(available.ValueType()==JsonValueType::Boolean)doc.available=available.GetBoolean()?1:0;else if(available.ValueType()!=JsonValueType::Null)throw std::runtime_error("availability");double v=d.GetNamedNumber(L"version");if(v<1||v>2147483647||v!=static_cast<int>(v)||doc.key.size()!=64)throw std::runtime_error("document");doc.version=static_cast<int>(v);entry.rows.push_back(std::move(doc));}
   reply.projects.push_back(std::move(entry));
  }
  reply.ok=true;reply.message=reply.projects.empty()?L"Ajoutez un projet au lecteur A: depuis Documents dans ArchiOffice.":L"Catalogue des projets montés dans A: · Propriétés en lecture seule";
 }catch(...){reply.ok=false;reply.pixels.clear();reply.projects.clear();reply.scope.clear();reply.message=L"Ouvrez ArchiOffice et vérifiez l'autorisation Drive ainsi que le montage de A:, puis actualisez.";}return reply;
}
