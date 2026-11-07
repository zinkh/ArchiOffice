#include "shell.hpp"
#include "navigation.hpp"
#include "presentation.hpp"
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <gdiplus.h>
#include <thread>
#include <chrono>
#include <oleacc.h>
#pragma comment(linker, "\"/manifestdependency:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='amd64' publicKeyToken='6595b64144ccf1df' language='*'\"")
namespace fs=std::filesystem;
#ifndef SHELL_DLL_FILE
#define SHELL_DLL_FILE L"archioffice-drive-shell-dev.dll"
#endif
std::wstring modulePath(){wchar_t buffer[32768];DWORD count=GetModuleFileNameW(nullptr,buffer,32768);if(!count||count==32768)throw std::runtime_error("module path");return buffer;}
std::wstring dllPath(){return (fs::path(modulePath()).parent_path()/SHELL_DLL_FILE).wstring();}
std::wstring classKey(){return std::wstring(L"Software\\Classes\\CLSID\\")+ShellGuid;}
std::wstring namespaceKey(){return std::wstring(L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MyComputer\\NameSpace\\")+ShellGuid;}
std::wstring read(HKEY hive,std::wstring const& key,wchar_t const* name=nullptr){wchar_t buffer[32768];DWORD size=sizeof(buffer);auto result=RegGetValueW(hive,key.c_str(),name,RRF_RT_REG_SZ,nullptr,buffer,&size);if(result==ERROR_FILE_NOT_FOUND)return L"";if(result!=ERROR_SUCCESS)throw std::runtime_error("registry read");return buffer;}
void set(HKEY hive,std::wstring const& key,wchar_t const* name,std::wstring const& value){if(RegSetKeyValueW(hive,key.c_str(),name,REG_SZ,value.c_str(),static_cast<DWORD>((value.size()+1)*sizeof(wchar_t)))!=ERROR_SUCCESS)throw std::runtime_error("registry write");}
void number(HKEY hive,std::wstring const& key,wchar_t const* name,DWORD value){if(RegSetKeyValueW(hive,key.c_str(),name,REG_DWORD,&value,sizeof(value))!=ERROR_SUCCESS)throw std::runtime_error("registry write");}
void registerShell(HKEY hive){
 if(!fs::is_regular_file(dllPath()))throw std::runtime_error("extension missing");auto key=classKey();auto previous=read(hive,key+L"\\InprocServer32");auto owner=read(hive,key,L"ArchiOfficeOwner");
 if(!previous.empty()&&owner!=L"com.archioffice.desktop.shell.v1")throw std::runtime_error("foreign registration");
 set(hive,key,nullptr,L"ArchiOffice Drive");set(hive,key,L"ArchiOfficeOwner",L"com.archioffice.desktop.shell.v1");set(hive,key+L"\\InprocServer32",nullptr,dllPath());set(hive,key+L"\\InprocServer32",L"ThreadingModel",L"Apartment");set(hive,key+L"\\DefaultIcon",nullptr,modulePath()+L",0");number(hive,key,L"System.IsPinnedToNameSpaceTree",1);number(hive,key+L"\\ShellFolder",L"Attributes",SFGAO_FOLDER|SFGAO_BROWSABLE);set(hive,namespaceKey(),nullptr,L"ArchiOffice Drive");SHChangeNotify(SHCNE_ASSOCCHANGED,SHCNF_IDLIST,nullptr,nullptr);
}
void unregisterShell(HKEY hive){auto key=classKey();if(read(hive,key,L"ArchiOfficeOwner")!=L"com.archioffice.desktop.shell.v1"||read(hive,key+L"\\InprocServer32")!=dllPath())return;RegDeleteTreeW(hive,namespaceKey().c_str());RegDeleteTreeW(hive,key.c_str());SHChangeNotify(SHCNE_ASSOCCHANGED,SHCNF_IDLIST,nullptr,nullptr);}
class Host final:public IShellBrowser {
 HWND window;
public:
 explicit Host(HWND hwnd):window(hwnd){}
 HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(id!=IID_IUnknown&&id!=IID_IOleWindow&&id!=IID_IShellBrowser)return E_NOINTERFACE;*out=static_cast<IShellBrowser*>(this);return S_OK;}
 ULONG STDMETHODCALLTYPE AddRef()override{return 2;}ULONG STDMETHODCALLTYPE Release()override{return 1;}
 HRESULT STDMETHODCALLTYPE GetWindow(HWND* out)override{if(!out)return E_POINTER;*out=window;return S_OK;}HRESULT STDMETHODCALLTYPE ContextSensitiveHelp(BOOL)override{return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE InsertMenusSB(HMENU,LPOLEMENUGROUPWIDTHS)override{return S_OK;}HRESULT STDMETHODCALLTYPE SetMenuSB(HMENU,HOLEMENU,HWND)override{return S_OK;}HRESULT STDMETHODCALLTYPE RemoveMenusSB(HMENU)override{return S_OK;}
 HRESULT STDMETHODCALLTYPE SetStatusTextSB(LPCWSTR)override{return S_OK;}HRESULT STDMETHODCALLTYPE EnableModelessSB(BOOL)override{return S_OK;}HRESULT STDMETHODCALLTYPE TranslateAcceleratorSB(MSG*,WORD)override{return S_FALSE;}
 HRESULT STDMETHODCALLTYPE BrowseObject(PCUIDLIST_RELATIVE,UINT)override{return E_NOTIMPL;}HRESULT STDMETHODCALLTYPE GetViewStateStream(DWORD,IStream** out)override{if(out)*out=nullptr;return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE GetControlWindow(UINT,HWND* out)override{if(out)*out=nullptr;return E_NOTIMPL;}HRESULT STDMETHODCALLTYPE SendControlMsg(UINT,UINT,WPARAM,LPARAM,LRESULT*)override{return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE QueryActiveShellView(IShellView** out)override{if(out)*out=nullptr;return E_NOTIMPL;}HRESULT STDMETHODCALLTYPE OnViewWindowActive(IShellView*)override{return S_OK;}
 HRESULT STDMETHODCALLTYPE SetToolbarItems(LPTBBUTTONSB,UINT,UINT)override{return S_OK;}
};
void check(HRESULT hr){if(FAILED(hr))throw std::runtime_error("COM operation failed");}
void pump(int ms){auto until=GetTickCount64()+ms;MSG msg;while(GetTickCount64()<until){while(PeekMessageW(&msg,nullptr,0,0,PM_REMOVE)){TranslateMessage(&msg);DispatchMessageW(&msg);}Sleep(10);}}
void screenshot(HWND hwnd,wchar_t const* destination){RECT rect;GetClientRect(hwnd,&rect);HDC dc=GetDC(hwnd);HDC target=CreateCompatibleDC(dc);HBITMAP bitmap=CreateCompatibleBitmap(dc,rect.right,rect.bottom);auto old=SelectObject(target,bitmap);SendMessageW(hwnd,WM_PRINT,reinterpret_cast<WPARAM>(target),PRF_CLIENT|PRF_CHILDREN|PRF_ERASEBKGND);ULONG_PTR token;Gdiplus::GdiplusStartupInput input;if(Gdiplus::GdiplusStartup(&token,&input,nullptr)!=Gdiplus::Ok)throw std::runtime_error("screenshot");CLSID png={0x557cf406,0x1a04,0x11d3,{0x9a,0x73,0x00,0x00,0xf8,0x1e,0xf3,0x2e}};{Gdiplus::Bitmap image(bitmap,nullptr);if(image.Save(destination,&png,nullptr)!=Gdiplus::Ok)throw std::runtime_error("save screenshot");}Gdiplus::GdiplusShutdown(token);SelectObject(target,old);DeleteObject(bitmap);DeleteDC(target);ReleaseDC(hwnd,dc);}
void accessibleName(HWND child,wchar_t const* expected){
 winrt::com_ptr<IAccessible> accessible;check(AccessibleObjectFromWindow(child,static_cast<DWORD>(OBJID_CLIENT),IID_IAccessible,accessible.put_void()));VARIANT self;VariantInit(&self);self.vt=VT_I4;self.lVal=CHILDID_SELF;BSTR label=nullptr;check(accessible->get_accName(self,&label));std::wstring actual=label?label:L"";SysFreeString(label);if(actual!=expected)throw std::runtime_error("accessible control name missing");
}
void settled(HWND child){for(int n=0;n<120&&!IsWindowEnabled(GetDlgItem(child,100));n++)pump(50);if(!IsWindowEnabled(GetDlgItem(child,100)))throw std::runtime_error("request did not settle");}
void selectPlan(HWND list){LVFINDINFOW find{};find.flags=LVFI_STRING;find.psz=L"Plan RDC.pdf";int row=ListView_FindItem(list,-1,&find);if(row<0)throw std::runtime_error("Plan missing");ListView_SetItemState(list,-1,0,LVIS_SELECTED|LVIS_FOCUSED);ListView_SetItemState(list,row,LVIS_SELECTED|LVIS_FOCUSED,LVIS_SELECTED|LVIS_FOCUSED);}
void clickColumn(HWND child,HWND list,int column){NMLISTVIEW event{};event.hdr.hwndFrom=list;event.hdr.idFrom=202;event.hdr.code=LVN_COLUMNCLICK;event.iSubItem=column;SendMessageW(child,WM_NOTIFY,202,reinterpret_cast<LPARAM>(&event));}
void smoke(wchar_t const* destination,bool large=false){
 Presentation bad;bad.order[1]=bad.order[0];if(validPresentation(bad))throw std::runtime_error("duplicate column order accepted");bad=Presentation{};bad.widths[0]=-1;if(validPresentation(bad))throw std::runtime_error("invalid width accepted");
 Project p;p.id=L"p";p.name=L"Projet";Document unknown;
 if(matches(Filter{ViewKind::Offline},p,unknown)||matches(Filter{ViewKind::Unclassified},p,unknown)||matches(Filter{ViewKind::Conflict},p,unknown))throw std::runtime_error("unknown states were classified");

 winrt::com_ptr<IShellFolder> registered;check(CoCreateInstance(ShellClsid,nullptr,CLSCTX_INPROC_SERVER,IID_IShellFolder,registered.put_void()));registered=nullptr;
 auto library=LoadLibraryW(dllPath().c_str());if(!library)throw std::runtime_error("DLL load failed");auto get=reinterpret_cast<HRESULT(__stdcall*)(REFCLSID,REFIID,void**)>(GetProcAddress(library,"DllGetClassObject"));auto unload=reinterpret_cast<HRESULT(__stdcall*)()>(GetProcAddress(library,"DllCanUnloadNow"));if(!get||!unload)throw std::runtime_error("exports");
 winrt::com_ptr<IClassFactory> factory;check(get(ShellClsid,IID_IClassFactory,factory.put_void()));winrt::com_ptr<IShellFolder> folder;check(factory->CreateInstance(nullptr,IID_IShellFolder,folder.put_void()));winrt::com_ptr<IShellView> view;check(folder->CreateViewObject(nullptr,IID_IShellView,view.put_void()));
 HWND parent=CreateWindowExW(0,L"STATIC",L"ArchiOffice Shell smoke",WS_OVERLAPPEDWINDOW|WS_VISIBLE,40,40,1320,850,nullptr,nullptr,GetModuleHandleW(nullptr),nullptr);Host host(parent);RECT rect{0,0,1280,800};FOLDERSETTINGS settings{FVM_DETAILS,FWF_AUTOARRANGE};HWND child=nullptr;check(view->CreateViewWindow(nullptr,&settings,&host,&rect,&child));
 if(large){auto list=GetDlgItem(child,202);for(int n=0;n<200&&ListView_GetItemCount(list)!=1003;n++)pump(50);if(ListView_GetItemCount(list)!=1003)throw std::runtime_error("large catalogue incomplete");ListView_SetItemState(list,-1,0,LVIS_SELECTED|LVIS_FOCUSED);ListView_SetItemState(list,1002,LVIS_SELECTED|LVIS_FOCUSED,LVIS_SELECTED|LVIS_FOCUSED);pump(50);wchar_t detail[8192]{};GetWindowTextW(GetDlgItem(child,203),detail,8192);if(std::wstring(detail).find(L"PROPRIÉTÉS")==std::wstring::npos)throw std::runtime_error("large catalogue properties missing");check(view->DestroyViewWindow());DestroyWindow(parent);view=nullptr;folder=nullptr;factory=nullptr;pump(100);if(unload()!=S_OK)throw std::runtime_error("large catalogue COM leak");FreeLibrary(library);return;}
 auto list=GetDlgItem(child,202);auto details=GetDlgItem(child,203);for(int n=0;n<120&&ListView_GetItemCount(list)!=2;n++)pump(50);if(ListView_GetItemCount(list)!=2)throw std::runtime_error("catalog not loaded");ListView_SetItemState(list,0,LVIS_SELECTED|LVIS_FOCUSED,LVIS_SELECTED|LVIS_FOCUSED);pump(100);wchar_t buffer[8192];GetWindowTextW(details,buffer,8192);if(std::wstring(buffer).find(L"PROPRIÉTÉS")==std::wstring::npos||std::wstring(buffer).find(L"VIP-TC")==std::wstring::npos)throw std::runtime_error("properties missing");

 auto tree=GetDlgItem(child,201),refresh=GetDlgItem(child,100),open=GetDlgItem(child,101);
 SendMessageW(child,WM_COMMAND,216,0);
 if(Header_GetItemCount(ListView_GetHeader(list))!=ColumnCount)throw std::runtime_error("seven business columns missing");
 wchar_t sync[100]{};ListView_GetItemText(list,0,6,sync,100);if(std::wstring(sync).empty())throw std::runtime_error("transfer state missing");
 selectPlan(list);clickColumn(child,list,4);wchar_t version[40]{};ListView_GetItemText(list,0,4,version,40);if(std::wstring(version)!=L"2")throw std::runtime_error("ascending numeric version sort");
 auto selectedRow=ListView_GetNextItem(list,-1,LVNI_SELECTED);wchar_t selectedName[100]{};ListView_GetItemText(list,selectedRow,0,selectedName,100);if(std::wstring(selectedName)!=L"Plan RDC.pdf")throw std::runtime_error("sort moved selection to wrong document");
 clickColumn(child,list,4);ListView_GetItemText(list,0,4,version,40);if(std::wstring(version)!=L"12")throw std::runtime_error("descending numeric version sort");
 SetFocus(list);BYTE multiKeys[256],savedKeys[256];GetKeyboardState(savedKeys);memcpy(multiKeys,savedKeys,sizeof(multiKeys));multiKeys[VK_CONTROL]=0x80;SetKeyboardState(multiKeys);MSG all{};all.hwnd=list;all.message=WM_KEYDOWN;all.wParam='A';view->TranslateAccelerator(&all);SetKeyboardState(savedKeys);
 if(ListView_GetSelectedCount(list)!=2||IsWindowEnabled(open)||IsWindowEnabled(GetDlgItem(child,102)))throw std::runtime_error("ambiguous multi-selection action");
 view->Refresh();settled(child);if(ListView_GetSelectedCount(list)!=2)throw std::runtime_error("refresh lost multi-selection");
 selectPlan(list);
 ListView_SetColumnWidth(list,1,140);int columnOrder[ColumnCount]={0,4,1,2,3,5,6};ListView_SetColumnOrderArray(list,ColumnCount,columnOrder);
 NMHEADERW resized{};resized.hdr.hwndFrom=ListView_GetHeader(list);resized.hdr.code=HDN_ENDTRACKW;SendMessageW(child,WM_NOTIFY,0,reinterpret_cast<LPARAM>(&resized));pump(50);

 accessibleName(tree,L"Navigation documentaire");accessibleName(list,L"Documents du projet");accessibleName(details,L"Propriétés du document, lecture seule");
 SetFocus(refresh);MSG tab{};tab.hwnd=refresh;tab.message=WM_KEYDOWN;tab.wParam=VK_TAB;view->TranslateAccelerator(&tab);if(GetFocus()!=open)throw std::runtime_error("Tab navigation failed");
 BYTE keys[256],original[256];GetKeyboardState(original);memcpy(keys,original,sizeof(keys));keys[VK_SHIFT]=0x80;SetKeyboardState(keys);tab.hwnd=open;view->TranslateAccelerator(&tab);SetKeyboardState(original);if(GetFocus()!=refresh)throw std::runtime_error("Shift Tab navigation failed");
 auto search=GetDlgItem(child,210);accessibleName(search,L"Rechercher dans les documents montés");
 auto rootNav=TreeView_GetRoot(tree),phaseNav=TreeView_GetNextSibling(tree,rootNav),typeNav=TreeView_GetNextSibling(tree,phaseNav),inboxNav=TreeView_GetNextSibling(tree,typeNav),offlineNav=TreeView_GetNextSibling(tree,inboxNav),conflictNav=TreeView_GetNextSibling(tree,offlineNav);
 if(!conflictNav||TreeView_GetNextSibling(tree,conflictNav))throw std::runtime_error("six navigation views missing");
 for(auto item:{TreeView_GetChild(tree,typeNav),inboxNav,offlineNav,conflictNav}){TreeView_SelectItem(tree,item);pump(30);if(ListView_GetItemCount(list)!=1)throw std::runtime_error("business navigation filter");}
 TreeView_SelectItem(tree,TreeView_GetChild(tree,typeNav));SendMessageW(child,WM_COMMAND,101,0);settled(child);
 TreeView_SelectItem(tree,TreeView_GetChild(tree,phaseNav));selectPlan(list);SendMessageW(child,WM_COMMAND,101,0);settled(child);
 SendMessageW(child,WM_COMMAND,215,0);SetWindowTextW(search,L"pixerecourt plan");pump(250);if(ListView_GetItemCount(list)!=1)throw std::runtime_error("accent-insensitive combined search");
 SetWindowTextW(search,L"introuvable");pump(250);if(ListView_GetItemCount(list)!=0||IsWindowEnabled(open))throw std::runtime_error("empty search still permits open");
 SendMessageW(child,WM_COMMAND,215,0);
 auto types=GetDlgItem(child,213),states=GetDlgItem(child,214);SendMessageW(types,CB_SETCURSEL,1,0);SendMessageW(child,WM_COMMAND,MAKEWPARAM(213,CBN_SELCHANGE),reinterpret_cast<LPARAM>(types));
 if(ListView_GetItemCount(list)!=1)throw std::runtime_error("documentary type filter");
 // Status choices are sorted: approuve first, en_cours second.
 SendMessageW(states,CB_SETCURSEL,2,0);SendMessageW(child,WM_COMMAND,MAKEWPARAM(214,CBN_SELCHANGE),reinterpret_cast<LPARAM>(states));if(ListView_GetItemCount(list)!=0)throw std::runtime_error("filters are not combined");
 SendMessageW(child,WM_COMMAND,215,0);if(ListView_GetItemCount(list)!=2)throw std::runtime_error("filter reset");
 selectPlan(list);screenshot(child,destination);
 auto root=TreeView_GetRoot(tree),project=TreeView_GetChild(tree,root);TreeView_Expand(tree,project,TVE_COLLAPSE);view->Refresh();settled(child);if(TreeView_GetRoot(tree)!=root||(TreeView_GetItemState(tree,project,TVIS_EXPANDED)&TVIS_EXPANDED))throw std::runtime_error("unchanged catalog reset navigation");
 MoveWindow(child,0,0,780,800,TRUE);pump(50);if(!IsWindowVisible(GetDlgItem(child,103)))throw std::runtime_error("narrow properties action missing");SendMessageW(child,WM_COMMAND,103,0);if(!IsWindowVisible(details)||IsWindowVisible(list))throw std::runtime_error("narrow properties unavailable");
 auto narrow=fs::path(destination);narrow.replace_filename(L"shell-prototype-narrow.png");screenshot(child,narrow.c_str());SendMessageW(child,WM_COMMAND,103,0);
 MoveWindow(parent,20,20,2000,1300,TRUE);MoveWindow(child,0,0,1920,1200,TRUE);SendMessageW(child,WM_DPICHANGED,MAKEWPARAM(144,144),0);pump(50);RECT button;GetClientRect(refresh,&button);if(button.right!=165||ListView_GetColumnWidth(list,0)!=390)throw std::runtime_error("DPI geometry not scaled");
 auto scaled=fs::path(destination);scaled.replace_filename(L"shell-prototype-dpi150.png");screenshot(child,scaled.c_str());SendMessageW(child,WM_DPICHANGED,MAKEWPARAM(96,96),0);MoveWindow(child,0,0,1280,800,TRUE);
 // Recreate the same view with its account still active: widths/order/sort reload.
 view->Refresh();check(view->DestroyViewWindow());check(view->CreateViewWindow(nullptr,&settings,&host,&rect,&child));settled(child);list=GetDlgItem(child,202);details=GetDlgItem(child,203);
 int restoredOrder[ColumnCount]{};ListView_GetColumnOrderArray(list,ColumnCount,restoredOrder);
 if(ListView_GetColumnWidth(list,1)!=140||restoredOrder[1]!=4)throw std::runtime_error("presentation did not persist across recreation");
 ListView_GetItemText(list,0,4,version,40);if(std::wstring(version)!=L"12")throw std::runtime_error("sort preference did not persist");
 selectPlan(list);
 auto tabs=GetDlgItem(child,220),canvas=GetDlgItem(child,224);accessibleName(tabs,L"Propriétés, aperçu et versions");
 auto selectTab=[&](int index){TabCtrl_SetCurSel(tabs,index);NMHDR notify{};notify.hwndFrom=tabs;notify.code=TCN_SELCHANGE;SendMessageW(child,WM_NOTIFY,220,reinterpret_cast<LPARAM>(&notify));};
 auto waitText=[&](HWND target,wchar_t const* expected){wchar_t text[8192]{};for(int n=0;n<200;n++){pump(50);GetWindowTextW(target,text,8192);if(std::wstring(text).find(expected)!=std::wstring::npos)return;}throw std::runtime_error("selected document panel did not load: expected "+winrt::to_string(expected)+", received "+winrt::to_string(text));};
 selectTab(1);waitText(canvas,L"Aperçu de la page 1");if(!IsWindowEnabled(GetDlgItem(child,222)))throw std::runtime_error("PDF page navigation unavailable");
 auto previewImage=fs::path(destination);previewImage.replace_filename(L"shell-preview-pdf.png");screenshot(child,previewImage.c_str());
 SendMessageW(child,WM_COMMAND,222,0);waitText(canvas,L"Aperçu de la page 2");
 selectTab(2);waitText(GetDlgItem(child,223),L"Version 12");
 LVFINDINFOW notice{};notice.flags=LVFI_STRING;notice.psz=L"Notice.docx";int noticeIndex=ListView_FindItem(list,-1,&notice);ListView_SetItemState(list,-1,0,LVIS_SELECTED);ListView_SetItemState(list,noticeIndex,LVIS_SELECTED,LVIS_SELECTED);
 selectTab(1);waitText(canvas,L"Aperçu indisponible pour ce format");
 selectPlan(list);selectTab(0);SendMessageW(child,WM_COMMAND,101,0);settled(child);SendMessageW(child,WM_COMMAND,102,0);settled(child);
 // The test broker invalidates its identity after the document action.
 view->Refresh();for(int n=0;n<120&&ListView_GetItemCount(list);n++)pump(50);if(ListView_GetItemCount(list)!=0)throw std::runtime_error("stale identity retained");
 view->Refresh();check(view->DestroyViewWindow());
 check(view->CreateViewWindow(nullptr,&settings,&host,&rect,&child));settled(child);
 if(ListView_GetItemCount(GetDlgItem(child,202))!=0)throw std::runtime_error("recreated view retained old data");
 check(view->DestroyViewWindow());DestroyWindow(parent);view=nullptr;folder=nullptr;factory=nullptr;pump(100);if(unload()!=S_OK)throw std::runtime_error("COM objects not released");FreeLibrary(library);
}
int wmain(int argc,wchar_t** argv){try{
 SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);check(CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED));if(argc<2)return 2;std::wstring action=argv[1];
 if(action==L"--register")registerShell(HKEY_CURRENT_USER);else if(action==L"--register-machine")registerShell(HKEY_LOCAL_MACHINE);else if(action==L"--unregister")unregisterShell(HKEY_CURRENT_USER);else if(action==L"--unregister-machine")unregisterShell(HKEY_LOCAL_MACHINE);
 else if(action==L"--runtime"&&argc==4){std::wstring pipe=argv[2],token=argv[3],prefix=L"\\\\.\\pipe\\ArchiOffice.DriveShell.";if(!pipe.starts_with(prefix)||pipe.size()!=prefix.size()+36||pipe.substr(prefix.size()).find_first_not_of(L"0123456789abcdef-")!=std::wstring::npos||token.size()!=64||token.find_first_not_of(L"0123456789abcdef")!=std::wstring::npos)throw std::runtime_error("invalid endpoint");set(HKEY_CURRENT_USER,RuntimeKey,L"Pipe",pipe);set(HKEY_CURRENT_USER,RuntimeKey,L"Token",token);}
 else if(action==L"--clear-runtime"&&argc==3){if(read(HKEY_CURRENT_USER,RuntimeKey,L"Pipe")==argv[2]){HKEY key;if(RegOpenKeyExW(HKEY_CURRENT_USER,RuntimeKey,0,KEY_SET_VALUE,&key)==ERROR_SUCCESS){RegDeleteValueW(key,L"Pipe");RegDeleteValueW(key,L"Token");RegCloseKey(key);}}}
 else if(action==L"--open"){auto args=std::wstring(L"shell:::")+ShellGuid;if(reinterpret_cast<INT_PTR>(ShellExecuteW(nullptr,L"open",L"explorer.exe",args.c_str(),nullptr,SW_SHOWNORMAL))<=32)throw std::runtime_error("Explorer unavailable");}
 else if(action==L"--large-smoke"&&argc==3)smoke(argv[2],true);else if(action==L"--smoke"&&argc==3)smoke(argv[2]);else return 2;CoUninitialize();return 0;
 }catch(std::exception const& error){std::cerr<<error.what()<<std::endl;return 1;}catch(...){std::cerr<<"ArchiOffice Shell operation unavailable."<<std::endl;return 1;}}
