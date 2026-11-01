// Experimental CFAPI provider with explicit per-project editing. Network, authentication and integrity
// belong to the agent. The private parent pipe supplies verified cache paths.
#define WIN32_NO_STATUS
#include <windows.h>
#undef WIN32_NO_STATUS
#include <winternl.h>
#include <ntstatus.h>
#include <cfapi.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Data.Json.h>
#include <algorithm>
#include <cwctype>
#include <stdexcept>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <filesystem>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>
using namespace winrt::Windows::Data::Json;
namespace fs = std::filesystem;
constexpr LONGLONG MaxFile = 50LL * 1024 * 1024;
constexpr NTSTATUS CloudFailure = STATUS_CLOUD_FILE_ACCESS_DENIED;
struct Pending { std::condition_variable cv; bool ready=false; std::wstring file; };
struct Entry { std::wstring path; std::string key; bool folder; LONGLONG size; };
std::mutex stateMutex, outputMutex;
std::map<std::string,std::shared_ptr<Pending>> pending;
std::atomic<unsigned long> sequence{0};
std::atomic<bool> stopping{false};
CF_CONNECTION_KEY connection{};
void emit(std::string const& line) { std::lock_guard lock(outputMutex);std::cout << line << std::endl; }
void check(HRESULT hr) { if(FAILED(hr))winrt::throw_hresult(hr); }
bool line(std::string& value) {
  value.clear();char c;
  while(std::cin.get(c)) {if(c=='\n')return true;if(value.size()>=1024*1024)throw std::runtime_error("frame too large");value+=c;}
  return false;
}
bool hexKey(std::string const& key) {return key.size()==64&&key.find_first_not_of("0123456789abcdef")==std::string::npos;}
bool safePart(std::wstring const& name) {
  if(name.empty()||name.size()>120||name==L"."||name==L".."||name.back()==L'.'||name.back()==L' ')return false;
  for(wchar_t c:name)if(c<32||std::wstring(L"<>:\"/\\|?*").find(c)!=std::wstring::npos)return false;
  auto stem=name.substr(0,name.find(L'.'));for(auto& c:stem)c=static_cast<wchar_t>(towupper(c));
  if(stem==L"CON"||stem==L"PRN"||stem==L"AUX"||stem==L"NUL")return false;
  if(stem.size()==4&&(stem.substr(0,3)==L"COM"||stem.substr(0,3)==L"LPT")&&stem[3]>=L'0'&&stem[3]<=L'9')return false;
  return true;
}
void transfer(CF_CALLBACK_INFO const* info, void const* buffer,LONGLONG offset,LONGLONG length,NTSTATUS status) {
  CF_OPERATION_INFO operation{};operation.StructSize=sizeof(operation);operation.Type=CF_OPERATION_TYPE_TRANSFER_DATA;
  operation.ConnectionKey=info->ConnectionKey;operation.TransferKey=info->TransferKey;operation.RequestKey=info->RequestKey;
  CF_OPERATION_PARAMETERS parameters{};parameters.ParamSize=static_cast<ULONG>(offsetof(CF_OPERATION_PARAMETERS,TransferData)+sizeof(parameters.TransferData));
  parameters.TransferData.CompletionStatus=status;parameters.TransferData.Buffer=buffer;
  parameters.TransferData.Offset.QuadPart=offset;parameters.TransferData.Length.QuadPart=length;
  check(CfExecute(&operation,&parameters));
}
void CALLBACK fetch(CF_CALLBACK_INFO const* info,CF_CALLBACK_PARAMETERS const* params) {
  HANDLE file=INVALID_HANDLE_VALUE;std::string id;
  try {
    if(stopping||info->FileIdentityLength!=64||info->FileSize.QuadPart<0||info->FileSize.QuadPart>MaxFile)throw std::runtime_error("invalid request");
    std::string key(static_cast<char const*>(info->FileIdentity),info->FileIdentityLength);
    if(!hexKey(key))throw std::runtime_error("invalid identity");
    auto request=std::make_shared<Pending>();id=std::to_string(++sequence);
    {std::lock_guard lock(stateMutex);if(pending.size()>=8)throw std::runtime_error("busy");pending.emplace(id,request);}
    emit("{\"type\":\"hydrate\",\"requestId\":\""+id+"\",\"key\":\""+key+"\"}");
    std::wstring source;
    {std::unique_lock lock(stateMutex);
      bool arrived=request->cv.wait_for(lock,std::chrono::seconds(45),[&]{return request->ready||stopping.load();});
      pending.erase(id);if(!arrived||stopping||request->file.empty())throw std::runtime_error("unavailable");source=request->file;
    }
    file=CreateFileW(source.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
    if(file==INVALID_HANDLE_VALUE)winrt::throw_last_error();
    BY_HANDLE_FILE_INFORMATION attributes{};LARGE_INTEGER size{};
    if(!GetFileInformationByHandle(file,&attributes)||!GetFileSizeEx(file,&size))winrt::throw_last_error();
    if((attributes.dwFileAttributes&(FILE_ATTRIBUTE_REPARSE_POINT|FILE_ATTRIBUTE_DIRECTORY))||size.QuadPart!=info->FileSize.QuadPart)throw std::runtime_error("invalid cache");
    std::vector<char> bytes(4*1024*1024);LONGLONG offset=0;
    while(offset<size.QuadPart) {
      if(stopping)throw std::runtime_error("stopped");DWORD count=static_cast<DWORD>(std::min<LONGLONG>(bytes.size(),size.QuadPart-offset));DWORD read=0;
      if(!ReadFile(file,bytes.data(),count,&read,nullptr)||read!=count)throw std::runtime_error("cache read failed");
      transfer(info,bytes.data(),offset,count,0);offset+=count;
    }
    CloseHandle(file);file=INVALID_HANDLE_VALUE;
  }catch(...) {
    if(file!=INVALID_HANDLE_VALUE)CloseHandle(file);
    if(!id.empty()){std::lock_guard lock(stateMutex);pending.erase(id);}
    try {transfer(info,nullptr,params->FetchData.RequiredFileOffset.QuadPart,params->FetchData.RequiredLength.QuadPart,CloudFailure);}catch(...){}
  }
}
void CALLBACK denyDelete(CF_CALLBACK_INFO const* info,CF_CALLBACK_PARAMETERS const*) {
  CF_OPERATION_INFO op{};op.StructSize=sizeof(op);op.Type=CF_OPERATION_TYPE_ACK_DELETE;op.ConnectionKey=info->ConnectionKey;op.TransferKey=info->TransferKey;op.RequestKey=info->RequestKey;
  CF_OPERATION_PARAMETERS p{};p.ParamSize=static_cast<ULONG>(offsetof(CF_OPERATION_PARAMETERS,AckDelete)+sizeof(p.AckDelete));p.AckDelete.CompletionStatus=CloudFailure;CfExecute(&op,&p);
}
void CALLBACK denyRename(CF_CALLBACK_INFO const* info,CF_CALLBACK_PARAMETERS const*) {
  CF_OPERATION_INFO op{};op.StructSize=sizeof(op);op.Type=CF_OPERATION_TYPE_ACK_RENAME;op.ConnectionKey=info->ConnectionKey;op.TransferKey=info->TransferKey;op.RequestKey=info->RequestKey;
  CF_OPERATION_PARAMETERS p{};p.ParamSize=static_cast<ULONG>(offsetof(CF_OPERATION_PARAMETERS,AckRename)+sizeof(p.AckRename));p.AckRename.CompletionStatus=CloudFailure;CfExecute(&op,&p);
}
// A: is a per-logon DOS device, never a formatted volume or a network share.
// Only remove our exact target; never pop an unrelated device definition.
struct DriveA {
  std::wstring target;
  bool labelled=false;
  static constexpr wchar_t LabelKey[]=L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\DriveIcons\\A\\DefaultLabel";
  static std::wstring query() {
    wchar_t buffer[32768];
    if(QueryDosDeviceW(L"A:",buffer,32768))return buffer;
    if(GetLastError()!=ERROR_FILE_NOT_FOUND)throw std::runtime_error("drive query failed");
    return L"";
  }
  static std::wstring raw(fs::path const& root) {
    if(!root.is_absolute()||root.wstring().starts_with(L"\\\\"))throw std::runtime_error("local root required");
    return L"\\??\\"+root.wstring();
  }
  void mount(fs::path const& root,std::wstring const& previous) {
    auto existing=query();
    if(!existing.empty()&&!previous.empty()&&existing==raw(fs::path(previous))) {
      if(!DefineDosDeviceW(DDD_RAW_TARGET_PATH|DDD_REMOVE_DEFINITION|DDD_EXACT_MATCH_ON_REMOVE,L"A:",existing.c_str()))throw std::runtime_error("drive cleanup failed");
      existing=query();
    }
    if(!existing.empty()||(GetLogicalDrives()&1))throw std::runtime_error("DRIVE_LETTER_IN_USE");
    auto next=raw(root);
    if(!DefineDosDeviceW(DDD_RAW_TARGET_PATH,L"A:",next.c_str()))throw std::runtime_error("drive mount failed");
    target=next;
    wchar_t label[256];DWORD bytes=sizeof(label);
    // Never relabel an existing cabinet/user customization or the real volume.
    auto labelResult=RegGetValueW(HKEY_CURRENT_USER,LabelKey,nullptr,RRF_RT_REG_SZ,nullptr,label,&bytes);
    if(labelResult==ERROR_SUCCESS&&!previous.empty()&&std::wstring(label)==L"ArchiOffice Drive")labelled=true;
    if(labelResult==ERROR_FILE_NOT_FOUND) {
      constexpr wchar_t name[]=L"ArchiOffice Drive";
      labelled=RegSetKeyValueW(HKEY_CURRENT_USER,LabelKey,nullptr,REG_SZ,name,sizeof(name))==ERROR_SUCCESS;
    }
  }
  ~DriveA() {
    if(!target.empty())DefineDosDeviceW(DDD_RAW_TARGET_PATH|DDD_REMOVE_DEFINITION|DDD_EXACT_MATCH_ON_REMOVE,L"A:",target.c_str());
    if(labelled) {
      wchar_t label[256];DWORD bytes=sizeof(label);
      if(RegGetValueW(HKEY_CURRENT_USER,LabelKey,nullptr,RRF_RT_REG_SZ,nullptr,label,&bytes)==ERROR_SUCCESS&&std::wstring(label)==L"ArchiOffice Drive") {
        HKEY key;
        if(RegOpenKeyExW(HKEY_CURRENT_USER,LabelKey,0,KEY_SET_VALUE,&key)==ERROR_SUCCESS){RegDeleteValueW(key,nullptr);RegCloseKey(key);}
      }
    }
  }
};

void validateRoot(fs::path const& root,std::string const& key) {
  alignas(CF_SYNC_ROOT_STANDARD_INFO) BYTE buffer[sizeof(CF_SYNC_ROOT_STANDARD_INFO)+128]{};DWORD returned=0;
  check(CfGetSyncRootInfoByPath(root.c_str(),CF_SYNC_ROOT_INFO_STANDARD,buffer,sizeof(buffer),&returned));
  auto info=reinterpret_cast<CF_SYNC_ROOT_STANDARD_INFO*>(buffer);
  if(info->SyncRootIdentityLength!=key.size()||std::string(reinterpret_cast<char*>(info->SyncRootIdentity),info->SyncRootIdentityLength)!=key)
    throw std::runtime_error("DRIVE_SNAPSHOT_INVALID");
}
// Validate attributes and opaque identity without hydrating or rewriting bytes.
void validateExisting(fs::path const& file,Entry const& entry,bool editable=false) {
  HANDLE handle=CreateFileW(file.c_str(),FILE_READ_ATTRIBUTES,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT|FILE_FLAG_BACKUP_SEMANTICS,nullptr);
  if(handle==INVALID_HANDLE_VALUE)throw std::runtime_error("DRIVE_SNAPSHOT_INVALID");
  try {
    BY_HANDLE_FILE_INFORMATION attributes{};LARGE_INTEGER size{};
    if(!GetFileInformationByHandle(handle,&attributes)||(!entry.folder&&!GetFileSizeEx(handle,&size)))throw std::runtime_error("DRIVE_SNAPSHOT_INVALID");
    if(!!(attributes.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)!=entry.folder||attributes.nNumberOfLinks>1
      ||(!entry.folder&&(size.QuadPart<0||size.QuadPart>MaxFile||(!editable&&size.QuadPart!=entry.size))))throw std::runtime_error("DRIVE_SNAPSHOT_INVALID");
    alignas(CF_PLACEHOLDER_STANDARD_INFO) BYTE buffer[sizeof(CF_PLACEHOLDER_STANDARD_INFO)+128]{};DWORD returned=0;
    auto status=CfGetPlaceholderInfo(handle,CF_PLACEHOLDER_INFO_STANDARD,buffer,sizeof(buffer),&returned);
    // A replace-save produces an ordinary local file. Only an explicitly
    // editable generation may reconnect it; unknown reparse points stay refused.
    if(FAILED(status)&&editable&&!entry.folder&&!(attributes.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)){CloseHandle(handle);return;}
    check(status);
    auto info=reinterpret_cast<CF_PLACEHOLDER_STANDARD_INFO*>(buffer);
    if(info->FileIdentityLength!=entry.key.size()||std::string(reinterpret_cast<char*>(info->FileIdentity),info->FileIdentityLength)!=entry.key
      ||(!entry.folder&&!editable&&(info->ModifiedDataSize.QuadPart!=0||info->InSyncState!=CF_IN_SYNC_STATE_IN_SYNC)))throw std::runtime_error("DRIVE_SNAPSHOT_INVALID");
    CloseHandle(handle);
  } catch(...) {CloseHandle(handle);throw;}
}

int wmain(int argc,wchar_t** argv) {
  bool connected=false;
  bool resuming=false;
  DriveA drive;
  struct Leases {std::map<std::string,HANDLE> handles;~Leases(){for(auto const& item:handles)CloseHandle(item.second);}} leases;
  try {
    winrt::init_apartment();
    if(argc==3&&std::wstring(argv[1])==L"--unregister") {check(CfUnregisterSyncRoot(argv[2]));return 0;}
    std::string text;if(!line(text))return 1;
    auto init=JsonObject::Parse(winrt::to_hstring(text));
    if(init.GetNamedString(L"type")==L"map") {
      fs::path base(std::wstring(init.GetNamedString(L"root")));
      if(!base.is_absolute()||!fs::is_directory(base))throw std::runtime_error("invalid namespace");
      fs::path current=base.root_path();for(auto const& part:base.relative_path()){current/=part;DWORD a=GetFileAttributesW(current.c_str());if(a==INVALID_FILE_ATTRIBUTES||(a&FILE_ATTRIBUTE_REPARSE_POINT))throw std::runtime_error("unsafe namespace");}
      drive.mount(base,std::wstring(init.GetNamedString(L"previousRoot",L"")));
      emit("{\"type\":\"ready\"}");
      while(line(text))if(JsonObject::Parse(winrt::to_hstring(text)).GetNamedString(L"type")==L"stop")break;
      emit("{\"type\":\"stopped\"}");return 0;
    }
    if(init.GetNamedString(L"type")!=L"init")throw std::runtime_error("init required");
    bool resume=init.GetNamedBoolean(L"resume",false),initializing=init.GetNamedBoolean(L"initializing",false);
    bool editable=init.GetNamedBoolean(L"editable",false);
    if(editable&&!resume)throw std::runtime_error("editing requires an existing generation");
    resuming=resume;
    std::string rootKey=winrt::to_string(init.GetNamedString(L"rootKey",L""));
    if(resume&&!hexKey(rootKey))throw std::runtime_error("DRIVE_SNAPSHOT_INVALID");
    fs::path root(std::wstring(init.GetNamedString(L"root")));if(!root.is_absolute()||!fs::is_directory(root)||(!resume&&!fs::is_empty(root)))throw std::runtime_error("fresh root required");
    // Refuse reparse points anywhere from the volume root down.
    fs::path current=root.root_path();for(auto const& part:root.relative_path()){current/=part;DWORD a=GetFileAttributesW(current.c_str());if(a==INVALID_FILE_ATTRIBUTES||(a&FILE_ATTRIBUTE_REPARSE_POINT))throw std::runtime_error("unsafe root");}
    auto array=init.GetNamedArray(L"entries");if(array.Size()>256)throw std::runtime_error("too many entries");
    std::vector<Entry> entries;std::map<std::wstring,bool> known;
    for(auto const& value:array) {
      auto item=value.GetObject();Entry e{std::wstring(item.GetNamedString(L"path")),winrt::to_string(item.GetNamedString(L"key")),item.GetNamedBoolean(L"folder"),0};
      double size=item.GetNamedNumber(L"size");if(size<0||size>MaxFile||size!=static_cast<LONGLONG>(size)||!hexKey(e.key))throw std::runtime_error("invalid entry");e.size=static_cast<LONGLONG>(size);
      fs::path relative(e.path);if(relative.is_absolute()||relative.has_root_name()||e.path.size()>300)throw std::runtime_error("invalid path");
      for(auto const& part:relative)if(!safePart(part.wstring()))throw std::runtime_error("invalid name");
      auto parent=relative.parent_path().wstring();if(!parent.empty()&&(!known.contains(parent)||!known.at(parent)))throw std::runtime_error("missing parent");
      auto folded=e.path;for(auto& c:folded)c=static_cast<wchar_t>(towlower(c));
      for(auto const& prior:entries){auto f=prior.path;for(auto& c:f)c=static_cast<wchar_t>(towlower(c));if(f==folded)throw std::runtime_error("collision");}
      known.emplace(e.path,e.folder);entries.push_back(e);
    }
    CF_SYNC_REGISTRATION reg{};reg.StructSize=sizeof(reg);reg.ProviderName=L"ArchiOffice Drive Preview";reg.ProviderVersion=L"0.1";
    if(!rootKey.empty()){reg.SyncRootIdentity=rootKey.data();reg.SyncRootIdentityLength=static_cast<DWORD>(rootKey.size());}
    CF_SYNC_POLICIES policies{};policies.StructSize=sizeof(policies);policies.Hydration.Primary=CF_HYDRATION_POLICY_FULL;policies.Population.Primary=CF_POPULATION_POLICY_ALWAYS_FULL;
    policies.InSync=CF_INSYNC_POLICY_TRACK_FILE_LAST_WRITE_TIME;
    if(resume) {
      try {validateRoot(root,rootKey);}
      catch(...) {if(!initializing||!fs::is_empty(root))throw;check(CfRegisterSyncRoot(root.c_str(),&reg,&policies,CF_REGISTER_FLAG_NONE));validateRoot(root,rootKey);}
      // A missing file, foreign placeholder or local edit blocks reconnection.
      // An interrupted first population may create only its missing entries.
      for(auto const& e:entries) {
        auto file=root/fs::path(e.path);DWORD attributes=GetFileAttributesW(file.c_str());
        if(attributes==INVALID_FILE_ATTRIBUTES) {
          if((!initializing&&!(editable&&!e.folder))||(GetLastError()!=ERROR_FILE_NOT_FOUND&&GetLastError()!=ERROR_PATH_NOT_FOUND))throw std::runtime_error("DRIVE_SNAPSHOT_INVALID");
        } else validateExisting(file,e,editable);
      }
    } else check(CfRegisterSyncRoot(root.c_str(),&reg,&policies,CF_REGISTER_FLAG_NONE));
    CF_CALLBACK_REGISTRATION callbacks[]={{CF_CALLBACK_TYPE_FETCH_DATA,fetch},{CF_CALLBACK_TYPE_NOTIFY_DELETE,denyDelete},{CF_CALLBACK_TYPE_NOTIFY_RENAME,denyRename},CF_CALLBACK_REGISTRATION_END};
    CF_CALLBACK_REGISTRATION editCallbacks[]={{CF_CALLBACK_TYPE_FETCH_DATA,fetch},CF_CALLBACK_REGISTRATION_END};
    check(CfConnectSyncRoot(root.c_str(),editable?editCallbacks:callbacks,nullptr,CF_CONNECT_FLAG_BLOCK_SELF_IMPLICIT_HYDRATION,&connection));connected=true;
    for(auto const& e:entries) {
      fs::path relative(e.path);auto base=root/relative.parent_path();auto name=relative.filename().wstring();
      if(resume&&GetFileAttributesW((root/relative).c_str())!=INVALID_FILE_ATTRIBUTES) {
        if(editable&&!e.folder){auto a=GetFileAttributesW((root/relative).c_str());if(a&FILE_ATTRIBUTE_READONLY)if(!SetFileAttributesW((root/relative).c_str(),a&~FILE_ATTRIBUTE_READONLY))winrt::throw_last_error();}
        continue;
      }
      // Never recreate a document deleted locally from an editable generation.
      if(resume&&editable&&!e.folder&&!initializing)continue;
      CF_PLACEHOLDER_CREATE_INFO p{};p.RelativeFileName=name.c_str();p.FileIdentity=e.key.data();p.FileIdentityLength=static_cast<DWORD>(e.key.size());
      p.FsMetadata.FileSize.QuadPart=e.size;p.FsMetadata.BasicInfo.FileAttributes=e.folder?FILE_ATTRIBUTE_DIRECTORY:FILE_ATTRIBUTE_READONLY|FILE_ATTRIBUTE_ARCHIVE;
      GetSystemTimeAsFileTime(reinterpret_cast<FILETIME*>(&p.FsMetadata.BasicInfo.CreationTime));p.FsMetadata.BasicInfo.LastWriteTime=p.FsMetadata.BasicInfo.CreationTime;
      p.Flags=static_cast<CF_PLACEHOLDER_CREATE_FLAGS>(CF_PLACEHOLDER_CREATE_FLAG_MARK_IN_SYNC|(e.folder?CF_PLACEHOLDER_CREATE_FLAG_DISABLE_ON_DEMAND_POPULATION:0));
      DWORD processed=0;check(CfCreatePlaceholders(base.c_str(),&p,1,CF_CREATE_FLAG_STOP_ON_ERROR,&processed));check(p.Result);
    }
    if(init.GetNamedBoolean(L"mountA",false)) {
      drive.mount(root,std::wstring(init.GetNamedString(L"previousRoot",L"")));
    }
    emit("{\"type\":\"ready\"}");
    while(line(text)) {
      auto message=JsonObject::Parse(winrt::to_hstring(text));auto type=message.GetNamedString(L"type");
      if(type==L"stop")break;
      if(type==L"unlock") {
        auto id=winrt::to_string(message.GetNamedString(L"requestId"));auto it=leases.handles.find(id);
        if(it!=leases.handles.end()){CloseHandle(it->second);leases.handles.erase(it);}
      }
      if(type==L"lock") {
        auto id=winrt::to_string(message.GetNamedString(L"requestId"));auto key=winrt::to_string(message.GetNamedString(L"key"));
        if(!editable||id.size()!=36||id.find_first_not_of("0123456789abcdef-")!=std::string::npos||leases.handles.contains(id)||leases.handles.size()>=8)throw std::runtime_error("invalid capture request");
        auto entry=std::find_if(entries.begin(),entries.end(),[&](Entry const& e){return !e.folder&&e.key==key;});
        if(entry==entries.end())throw std::runtime_error("unknown capture identity");
        HANDLE handle=INVALID_HANDLE_VALUE;
        try {
          validateRoot(root,rootKey);validateExisting(root/fs::path(entry->path),*entry,true);
          // FILE_SHARE_READ denies concurrent writers and replace-saves until
          // the parent has published its independently verified snapshot.
          handle=CreateFileW((root/fs::path(entry->path)).c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
        }catch(...){}
        bool valid=handle!=INVALID_HANDLE_VALUE;if(valid)leases.handles.emplace(id,handle);
        emit("{\"type\":\"locked\",\"requestId\":\""+id+"\",\"valid\":"+(valid?std::string("true"):std::string("false"))+"}");
      }
      if(type==L"changes") {
        auto request=winrt::to_string(message.GetNamedString(L"requestId"));
        if(!editable||request.size()!=36||request.find_first_not_of("0123456789abcdef-")!=std::string::npos)throw std::runtime_error("invalid changes request");
        validateRoot(root,rootKey);std::string keys;bool first=true;
        for(auto const& entry:entries)if(!entry.folder) {
          try{validateExisting(root/fs::path(entry.path),entry);}catch(...){if(!first)keys+=",";keys+="\""+entry.key+"\"";first=false;}
        }
        emit("{\"type\":\"changes\",\"requestId\":\""+request+"\",\"keys\":["+keys+"]}");
      }
      if(type==L"verify") {
        auto request=winrt::to_string(message.GetNamedString(L"requestId"));
        if(request.size()!=36||request.find_first_not_of("0123456789abcdef-")!=std::string::npos)throw std::runtime_error("invalid verification request");
        bool valid=true;
        try{validateRoot(root,rootKey);for(auto const& entry:entries)validateExisting(root/fs::path(entry.path),entry);}catch(...){valid=false;}
        emit("{\"type\":\"verified\",\"requestId\":\""+request+"\",\"valid\":"+(valid?std::string("true"):std::string("false"))+"}");
      }
      if(type==L"hydrated") {
        auto id=winrt::to_string(message.GetNamedString(L"requestId"));std::lock_guard lock(stateMutex);auto it=pending.find(id);
        if(it!=pending.end()){it->second->file=std::wstring(message.GetNamedString(L"file",L""));it->second->ready=true;it->second->cv.notify_one();}
      }
    }
    stopping=true;{std::lock_guard lock(stateMutex);for(auto const& p:pending)p.second->cv.notify_one();}
    check(CfDisconnectSyncRoot(connection));connected=false;emit("{\"type\":\"stopped\"}");return 0;
  }catch(...) {
    stopping=true;{std::lock_guard lock(stateMutex);for(auto const& p:pending)p.second->cv.notify_one();}
    if(connected)CfDisconnectSyncRoot(connection);
    auto hr=winrt::to_hresult();std::string code=resuming?"DRIVE_SNAPSHOT_INVALID":"NATIVE_FAILURE";
    try {throw;}catch(std::runtime_error const& e){if(std::string(e.what())=="DRIVE_LETTER_IN_USE"||std::string(e.what())=="DRIVE_SNAPSHOT_INVALID")code=e.what();}catch(...){}
    emit("{\"type\":\"error\",\"code\":\""+code+"\",\"hresult\":"+std::to_string(static_cast<unsigned long>(hr))+"}");return 1;
  }
}
