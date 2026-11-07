#include "shell.hpp"
#include <chrono>
#include <stdexcept>
using namespace winrt::Windows::Data::Json;
namespace {
struct Handle {HANDLE value=INVALID_HANDLE_VALUE;~Handle(){if(value!=INVALID_HANDLE_VALUE)CloseHandle(value);}};
std::wstring setting(wchar_t const* name){wchar_t value[512];DWORD size=sizeof(value);if(RegGetValueW(HKEY_CURRENT_USER,RuntimeKey,name,RRF_RT_REG_SZ,nullptr,value,&size)!=ERROR_SUCCESS)throw std::runtime_error("client unavailable");return value;}
bool valid(std::wstring const& s,size_t max){return !s.empty()&&s.size()<=max;}
void transfer(HANDLE pipe,bool write,char* bytes,DWORD size,DWORD& count,ULONGLONG deadline){
 Handle event;event.value=CreateEventW(nullptr,TRUE,FALSE,nullptr);if(!event.value)throw std::runtime_error("event");OVERLAPPED op{};op.hEvent=event.value;
 BOOL ready=write?WriteFile(pipe,bytes,size,&count,&op):ReadFile(pipe,bytes,size,&count,&op);
 if(!ready){if(GetLastError()!=ERROR_IO_PENDING)throw std::runtime_error("pipe");auto now=GetTickCount64();DWORD remaining=now<deadline?static_cast<DWORD>(deadline-now):0;
  if(WaitForSingleObject(event.value,remaining)!=WAIT_OBJECT_0){CancelIoEx(pipe,&op);GetOverlappedResult(pipe,&op,&count,TRUE);throw std::runtime_error("timeout");}
  if(!GetOverlappedResult(pipe,&op,&count,FALSE))throw std::runtime_error("pipe");
 }
}
std::wstring field(JsonObject const& value,wchar_t const* name,size_t limit){auto s=std::wstring(value.GetNamedString(name));if(s.size()>limit)throw std::runtime_error("field");return s;}
}
Reply request(std::wstring action,std::wstring project,std::wstring key,std::wstring revision){
 Reply reply;try{
  auto address=setting(L"Pipe"),token=setting(L"Token");std::wstring prefix=L"\\\\.\\pipe\\ArchiOffice.DriveShell.";
  if(!address.starts_with(prefix)||address.size()!=prefix.size()+36||address.substr(prefix.size()).find_first_not_of(L"0123456789abcdef-")!=std::wstring::npos||token.size()!=64||token.find_first_not_of(L"0123456789abcdef")!=std::wstring::npos)throw std::runtime_error("endpoint");
  if(!WaitNamedPipeW(address.c_str(),500))throw std::runtime_error("client unavailable");Handle pipe;
  pipe.value=CreateFileW(address.c_str(),GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,FILE_FLAG_OVERLAPPED|SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION,nullptr);
  if(pipe.value==INVALID_HANDLE_VALUE)throw std::runtime_error("client unavailable");
  JsonObject input;input.SetNamedValue(L"format",JsonValue::CreateNumberValue(1));input.SetNamedValue(L"token",JsonValue::CreateStringValue(token));input.SetNamedValue(L"action",JsonValue::CreateStringValue(action));
  input.SetNamedValue(L"projectId",JsonValue::CreateStringValue(project));input.SetNamedValue(L"key",JsonValue::CreateStringValue(key));input.SetNamedValue(L"revision",JsonValue::CreateStringValue(revision));
  auto data=winrt::to_string(input.Stringify())+"\n";auto deadline=GetTickCount64()+5000;DWORD count=0;transfer(pipe.value,true,data.data(),static_cast<DWORD>(data.size()),count,deadline);if(count!=data.size())throw std::runtime_error("write");
  std::string response;char buffer[16384];while(response.find('\n')==std::string::npos){transfer(pipe.value,false,buffer,sizeof(buffer),count,deadline);if(!count)throw std::runtime_error("eof");response.append(buffer,count);if(response.size()>2*1024*1024)throw std::runtime_error("response size");}
  auto value=JsonObject::Parse(winrt::to_hstring(response.substr(0,response.find('\n'))));auto status=value.GetNamedString(L"status");
  if(action!=L"catalog"){reply.ok=status==L"opened";reply.message=reply.ok?L"Document ouvert.":L"Ouverture indisponible. Actualisez le catalogue et vérifiez les droits Drive.";return reply;}
  if(status!=L"ok")throw std::runtime_error("access refused");reply.scope=field(value,L"scope",64);if(reply.scope.size()!=64)throw std::runtime_error("scope");auto projects=value.GetNamedArray(L"projects");if(projects.Size()>10)throw std::runtime_error("projects");
  for(auto const& item:projects){auto p=item.GetObject();Project entry;entry.id=field(p,L"id",200);entry.name=field(p,L"name",240);entry.revision=field(p,L"revision",64);auto rows=p.GetNamedArray(L"rows");if(rows.Size()>100||!valid(entry.id,200)||entry.revision.size()!=64)throw std::runtime_error("catalog");
   for(auto const& itemRow:rows){auto d=itemRow.GetObject();Document doc;doc.key=field(d,L"key",64);doc.name=field(d,L"name",512);doc.phase=field(d,L"phase",120);doc.type=field(d,L"type",200);doc.fileType=field(d,L"fileType",20);doc.indice=field(d,L"indice",200);doc.status=field(d,L"status",200);doc.transferState=field(d,L"transferState",40);
    doc.businessKnown=d.GetNamedBoolean(L"businessKnown");doc.unclassified=d.GetNamedBoolean(L"unclassified");auto available=d.GetNamedValue(L"available");if(available.ValueType()==JsonValueType::Boolean)doc.available=available.GetBoolean()?1:0;else if(available.ValueType()!=JsonValueType::Null)throw std::runtime_error("availability");double v=d.GetNamedNumber(L"version");if(v<1||v>2147483647||v!=static_cast<int>(v)||doc.key.size()!=64)throw std::runtime_error("document");doc.version=static_cast<int>(v);entry.rows.push_back(std::move(doc));}
   reply.projects.push_back(std::move(entry));
  }
  reply.ok=true;reply.message=reply.projects.empty()?L"Ajoutez un projet au lecteur A: depuis Documents dans ArchiOffice.":L"Catalogue des projets montés dans A: · Propriétés en lecture seule";
 }catch(...){reply.message=L"Ouvrez ArchiOffice et vérifiez l'autorisation Drive ainsi que le montage de A:, puis actualisez.";}return reply;
}
