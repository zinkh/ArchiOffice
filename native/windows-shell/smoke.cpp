#include <windows.h>
#include <shlobj.h>
#include <commctrl.h>
#include <stdexcept>
#include <iostream>
static const CLSID ClassId={0x67b0f7be,0x5f65,0x4aef,{0x9d,0x4b,0xb1,0x33,0xa9,0x91,0xd9,0x11}};
static void require(bool condition,const char* message){if(!condition)throw std::runtime_error(message);}
class Host final:public IShellBrowser {
public:
 HWND window;
 LONG refs=1;
 explicit Host(HWND hwnd):window(hwnd){}
 HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out) override{*out=nullptr;if(id!=IID_IUnknown&&id!=IID_IOleWindow&&id!=IID_IShellBrowser)return E_NOINTERFACE;*out=this;return S_OK;}
 ULONG STDMETHODCALLTYPE AddRef() override{return ++refs;}
 ULONG STDMETHODCALLTYPE Release() override{return --refs;}
 HRESULT STDMETHODCALLTYPE GetWindow(HWND* out) override{*out=window;return S_OK;}
 HRESULT STDMETHODCALLTYPE ContextSensitiveHelp(BOOL) override{return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE InsertMenusSB(HMENU,LPOLEMENUGROUPWIDTHS) override{return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE SetMenuSB(HMENU,HOLEMENU,HWND) override{return S_OK;}
 HRESULT STDMETHODCALLTYPE RemoveMenusSB(HMENU) override{return S_OK;}
 HRESULT STDMETHODCALLTYPE SetStatusTextSB(LPCWSTR) override{return S_OK;}
 HRESULT STDMETHODCALLTYPE EnableModelessSB(BOOL) override{return S_OK;}
 HRESULT STDMETHODCALLTYPE TranslateAcceleratorSB(MSG*,WORD) override{return S_FALSE;}
 HRESULT STDMETHODCALLTYPE BrowseObject(PCUIDLIST_RELATIVE,UINT) override{return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE GetViewStateStream(DWORD,IStream** out) override{*out=nullptr;return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE GetControlWindow(UINT,HWND* out) override{*out=nullptr;return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE SendControlMsg(UINT,UINT,WPARAM,LPARAM,LRESULT*) override{return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE QueryActiveShellView(IShellView** out) override{*out=nullptr;return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE OnViewWindowActive(IShellView*) override{return S_OK;}
 HRESULT STDMETHODCALLTYPE SetToolbarItems(LPTBBUTTONSB,UINT,UINT) override{return S_OK;}
};
int wmain(int argc,wchar_t** argv){
 try {
  require(argc==2,"Pass the DLL path");require(SUCCEEDED(CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED)),"COM init");
  auto dll=LoadLibraryW(argv[1]);require(dll!=nullptr,"DLL load");
  auto get=reinterpret_cast<HRESULT(__stdcall*)(REFCLSID,REFIID,void**)>(GetProcAddress(dll,"DllGetClassObject"));
  auto unload=reinterpret_cast<HRESULT(__stdcall*)()>(GetProcAddress(dll,"DllCanUnloadNow"));require(get&&unload,"exports");
  require(unload()==S_OK,"initial object count");
  IClassFactory* factory=nullptr;require(SUCCEEDED(get(ClassId,IID_IClassFactory,reinterpret_cast<void**>(&factory))),"factory");
  require(unload()==S_FALSE,"factory prevents unload");
  IShellFolder* folder=nullptr;require(SUCCEEDED(factory->CreateInstance(nullptr,IID_IShellFolder,reinterpret_cast<void**>(&folder))),"folder");factory->Release();
  IPersistFolder2* persist=nullptr;require(SUCCEEDED(folder->QueryInterface(IID_IPersistFolder2,reinterpret_cast<void**>(&persist))),"persist interface");
  PIDLIST_ABSOLUTE desktop=nullptr;require(SUCCEEDED(SHGetSpecialFolderLocation(nullptr,CSIDL_DESKTOP,&desktop)),"desktop pidl");
  require(SUCCEEDED(persist->Initialize(desktop)),"initialize");PIDLIST_ABSOLUTE copy=nullptr;require(SUCCEEDED(persist->GetCurFolder(&copy))&&ILIsEqual(desktop,copy),"pidl roundtrip");CoTaskMemFree(desktop);CoTaskMemFree(copy);persist->Release();
  IShellView* view=nullptr;require(SUCCEEDED(folder->CreateViewObject(nullptr,IID_IShellView,reinterpret_cast<void**>(&view))),"custom view");folder->Release();
  HWND parent=CreateWindowExW(0,L"STATIC",L"ArchiOffice Shell smoke",WS_OVERLAPPEDWINDOW,0,0,1200,700,nullptr,nullptr,GetModuleHandleW(nullptr),nullptr);require(parent!=nullptr,"host window");
  Host host(parent);RECT bounds{0,0,1200,700};FOLDERSETTINGS settings{FVM_DETAILS,FWF_SINGLESEL};HWND window=nullptr;
  require(SUCCEEDED(view->CreateViewWindow(nullptr,&settings,&host,&bounds,&window))&&IsWindow(window),"create view window");
  require(FindWindowExW(window,nullptr,L"LISTBOX",nullptr)!=nullptr,"left navigation");
  HWND list=FindWindowExW(window,nullptr,WC_LISTVIEWW,nullptr);require(list!=nullptr,"center documents");
  require(FindWindowExW(window,nullptr,L"EDIT",nullptr)!=nullptr,"right properties");
  for(int width:{640,1200,1920}){MoveWindow(window,0,0,width,700,TRUE);RECT r{};GetWindowRect(list,&r);require(r.right>r.left&&r.bottom>r.top,"resized document pane");}
  require(SUCCEEDED(view->UIActivate(SVUIA_ACTIVATE_FOCUS)),"activate");require(GetFocus()==list,"document focus");
  MSG tab{};tab.message=WM_KEYDOWN;tab.wParam=VK_TAB;require(view->TranslateAccelerator(&tab)==S_OK,"tab navigation");require(GetFocus()!=list,"focus advanced");
  MSG refresh{};refresh.message=WM_KEYDOWN;refresh.wParam=VK_F5;require(view->TranslateAccelerator(&refresh)==S_OK,"refresh");
  require(SUCCEEDED(view->DestroyViewWindow())&&!IsWindow(window),"window destruction");require(host.refs==1,"browser released on destruction");
  require(SUCCEEDED(view->CreateViewWindow(nullptr,&settings,&host,&bounds,&window))&&IsWindow(window),"recreate same view");
  require(host.refs==2,"browser retained once");
  require(SUCCEEDED(view->DestroyViewWindow())&&host.refs==1,"second destruction");
  view->Release();DestroyWindow(parent);
  require(unload()==S_OK,"no leaked COM objects");
  wchar_t className[100]{};swprintf_s(className,L"ArchiOfficeDrivePrototypeView-%p",static_cast<void*>(dll));
  WNDCLASSW registered{};require(!GetClassInfoW(dll,className,&registered),"window class removed before unload");
  FreeLibrary(dll);
  dll=LoadLibraryW(argv[1]);require(dll!=nullptr,"reload DLL");
  get=reinterpret_cast<HRESULT(__stdcall*)(REFCLSID,REFIID,void**)>(GetProcAddress(dll,"DllGetClassObject"));
  factory=nullptr;require(SUCCEEDED(get(ClassId,IID_IClassFactory,reinterpret_cast<void**>(&factory))),"factory after reload");factory->Release();
  FreeLibrary(dll);CoUninitialize();
  std::cout<<"IShellView: factory, persistence, three panes, resizing, keyboard and cleanup passed\n";return 0;
 } catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}
}
