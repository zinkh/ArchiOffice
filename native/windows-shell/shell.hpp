#pragma once
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <shlguid.h>
#include <commctrl.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Data.Json.h>
#include <atomic>
#include <string>
#include <vector>
inline constexpr GUID ShellClsid={0x7cfd969b,0xaef8,0x4d32,{0xa3,0x38,0x9d,0x47,0x29,0x88,0xda,0x21}};
inline constexpr wchar_t ShellGuid[]=L"{7CFD969B-AEF8-4D32-A338-9D472988DA21}";
inline constexpr wchar_t RuntimeKey[]=L"Software\\ArchiOffice\\DriveShell";
inline constexpr wchar_t ViewClass[]=L"ArchiOfficeDriveShellView";
inline constexpr UINT ResultMessage=WM_APP+94;
extern HINSTANCE moduleInstance;
extern std::atomic<long> objectCount;
struct Document {std::wstring key,name,phase,type,fileType,indice,status,transferState;int version=0,available=-1;bool businessKnown=false,unclassified=false;bool operator==(Document const&)const=default;};
struct Project {std::wstring id,name,revision;std::vector<Document> rows;bool operator==(Project const&)const=default;};
struct Reply {bool ok=false;std::wstring message,scope;std::vector<Project> projects;};
Reply request(std::wstring action,std::wstring project=L"",std::wstring key=L"",std::wstring revision=L"");
HRESULT createView(IShellFolder* folder,REFIID iid,void** result);
HRESULT createFolder(REFIID iid,void** result);
