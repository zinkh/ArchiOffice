// Experimental per-user namespace. A: remains the only source of file content.
// The DLL reads a leased business projection, never credentials or document copies.
#include <windows.h>
#include <shlobj.h>
#include <shellapi.h>
#include <shlwapi.h>
#include <commctrl.h>
#include <string>
#include <vector>
#include <algorithm>
#include <new>
#include <cwchar>
#include "catalog.hpp"

static const CLSID CLSID_Drive = {0x67b0f7be,0x5f65,0x4aef,{0x9d,0x4b,0xb1,0x33,0xa9,0x91,0xd9,0x11}};
static const wchar_t* ClassId = L"{67B0F7BE-5F65-4AEF-9D4B-B133A991D911}";
static HINSTANCE module;
static LONG objects = 0;
struct Entry { std::wstring name; DWORD attributes; ULONGLONG size; FILETIME modified; };

class View final : public IShellView {
    LONG refs = 1;
    HWND window = nullptr, navigation = nullptr, list = nullptr, properties = nullptr, location = nullptr;
    IShellBrowser* browser = nullptr;
    HFONT font = nullptr;
    wchar_t windowClass[100]{};
    std::wstring directory = L"A:\\";
    std::vector<Entry> entries;
    archioffice::Catalog catalog;
    std::wstring driveRoot,viewRoot;
    int left = 190, right = 290, drag = 0;
    int scale(int value) const { return MulDiv(value, window ? GetDpiForWindow(window) : 96, 96); }
    void layout() {
        RECT r{}; GetClientRect(window, &r);
        const int gap = scale(6), bar = scale(38);
        // Keep all panes reachable in narrow Explorer windows, with scrollable text/list.
        int l = std::min(scale(left), std::max(60, static_cast<int>(r.right) / 4));
        int p = std::min(scale(right), std::max(80, static_cast<int>(r.right) / 3));
        MoveWindow(location, scale(8), scale(5), std::max(0L,r.right-scale(16)),bar-scale(10),TRUE);
        MoveWindow(navigation,0,bar,l,std::max(0L,r.bottom-bar),TRUE);
        MoveWindow(list,l+gap,bar,std::max(0L,r.right-l-p-2*gap),std::max(0L,r.bottom-bar),TRUE);
        MoveWindow(properties,std::max(0L,r.right-p),bar,p,std::max(0L,r.bottom-bar),TRUE);
        InvalidateRect(window,nullptr,TRUE);
    }
    std::wstring childPath(int index) const {
        return directory + entries[static_cast<size_t>(index)].name;
    }
    void metadata() {
        catalog.clear();
        if(driveAvailable())catalog=archioffice::readCatalog(driveRoot);
    }
    void details() {
        if(!driveAvailable()||driveRoot!=viewRoot) {
            catalog.clear();SetWindowTextW(properties,L"Connexion du lecteur modifiée. Appuyez sur F5 pour recharger cette vue.");return;
        }
        int index = ListView_GetNextItem(list,-1,LVNI_SELECTED);
        if(index < 0 || static_cast<size_t>(index) >= entries.size()) {
            SetWindowTextW(properties,L"Propriétés\r\n\r\nSélectionnez un document.\r\n\r\nLes fichiers proviennent du lecteur A: existant.\r\n\r\nLes propriétés métier disponibles s’affichent à la sélection. Les aperçus seront ajoutés ensuite."); return;
        }
        const auto& e = entries[static_cast<size_t>(index)];
        std::wstring text = L"Propriétés\r\n\r\n" + e.name + L"\r\n\r\nEmplacement\r\n" + childPath(index);
        text += L"\r\n\r\nNature\r\n";
        text += (e.attributes & FILE_ATTRIBUTE_DIRECTORY) ? L"Dossier" : L"Document";
        if(!(e.attributes & FILE_ATTRIBUTE_DIRECTORY)) text += L"\r\n\r\nTaille\r\n" + std::to_wstring(e.size) + L" octets";
        SYSTEMTIME local{}; FILETIME time{};
        if(FileTimeToLocalFileTime(&e.modified,&time) && FileTimeToSystemTime(&time,&local)) {
            wchar_t date[80]{}, hour[80]{};
            GetDateFormatEx(LOCALE_NAME_USER_DEFAULT,DATE_SHORTDATE,&local,nullptr,date,80,nullptr);
            GetTimeFormatEx(LOCALE_NAME_USER_DEFAULT,TIME_NOSECONDS,&local,nullptr,hour,80);
            text += L"\r\n\r\nModifié sur le poste\r\n" + std::wstring(date) + L" " + hour;
        }
        auto found=catalog.find(directory.substr(3)+e.name);
        if(found!=catalog.end())text+=L"\r\n\r\n"+found->second.properties;
        else if(!(e.attributes&FILE_ATTRIBUTE_DIRECTORY))text+=L"\r\n\r\nCatalogue métier indisponible. Activez le client compatible ou attendez son actualisation.";
        text+=L"\r\n\r\nAperçu : prévu dans un lot ultérieur.";
        SetWindowTextW(properties,text.c_str());
    }
    bool driveAvailable() {
        driveRoot.clear();
        // Match the broker-owned per-account namespace, never an unrelated A:.
        wchar_t target[32768]{};
        if(!QueryDosDeviceW(L"A:",target,32768)) return false;
        PWSTR roaming=nullptr;
        if(FAILED(SHGetKnownFolderPath(FOLDERID_RoamingAppData,0,nullptr,&roaming))) return false;
        std::wstring prefix=std::wstring(L"\\??\\") + roaming + L"\\ArchiOffice Client\\drive-windows-namespaces\\";
        CoTaskMemFree(roaming);
        std::wstring actual=target;
        if(actual.size()!=prefix.size()+64 || _wcsnicmp(actual.c_str(),prefix.c_str(),prefix.size())!=0) return false;
        if(actual.find_first_not_of(L"0123456789abcdef",prefix.size())!=std::wstring::npos)return false;
        driveRoot=actual.substr(4);return true;
    }
    void load() {
        ListView_DeleteAllItems(list); entries.clear();metadata();viewRoot=driveRoot;
        SetWindowTextW(location,(L"ArchiOffice Drive  /  " + directory).c_str());
        EnableWindow(navigation,TRUE);
        if(!driveAvailable()) {
            SetWindowTextW(properties,L"Lecteur ArchiOffice indisponible\r\n\r\nActivez A: dans ArchiOffice, puis appuyez sur F5.\r\n\r\nUn autre lecteur A: n’est jamais parcouru par cette vue.");return;
        }
        WIN32_FIND_DATAW data{};
        HANDLE find = FindFirstFileW((directory + L"*").c_str(),&data);
        if(find == INVALID_HANDLE_VALUE) {
            const DWORD error = GetLastError();
            SetWindowTextW(properties,(L"Dossier indisponible\r\n\r\nActivez le lecteur A: dans ArchiOffice, puis appuyez sur F5.\r\n\r\nAucun fichier n’a été déplacé.\r\n\r\nCode Windows : " + std::to_wstring(error)).c_str()); return;
        }
        do {
            if(wcscmp(data.cFileName,L".")==0 || wcscmp(data.cFileName,L"..")==0) continue;
            entries.push_back({data.cFileName,data.dwFileAttributes,(static_cast<ULONGLONG>(data.nFileSizeHigh)<<32)|data.nFileSizeLow,data.ftLastWriteTime});
        } while(FindNextFileW(find,&data));
        DWORD error = GetLastError(); FindClose(find);
        std::sort(entries.begin(),entries.end(),[](const Entry& a,const Entry& b){
            bool ad=(a.attributes&FILE_ATTRIBUTE_DIRECTORY)!=0, bd=(b.attributes&FILE_ATTRIBUTE_DIRECTORY)!=0;
            return ad!=bd ? ad : StrCmpLogicalW(a.name.c_str(),b.name.c_str())<0;
        });
        for(size_t i=0;i<entries.size();++i) {
            auto& e=entries[i]; LVITEMW item{}; item.mask=LVIF_TEXT; item.iItem=static_cast<int>(i); item.pszText=e.name.data();
            ListView_InsertItem(list,&item);
            ListView_SetItemText(list,item.iItem,1,const_cast<wchar_t*>((e.attributes&FILE_ATTRIBUTE_DIRECTORY)?L"Dossier":L"Document"));
            std::wstring size=(e.attributes&FILE_ATTRIBUTE_DIRECTORY)?L"":std::to_wstring(e.size);
            ListView_SetItemText(list,item.iItem,2,size.data());
        }
        if(error!=ERROR_NO_MORE_FILES) SetWindowTextW(properties,L"Lecture interrompue. Appuyez sur F5 pour réessayer.");
        else if(entries.empty()) SetWindowTextW(properties,L"Ce dossier est vide.\r\n\r\nAjoutez vos projets au lecteur A: depuis ArchiOffice.");
        else { ListView_SetItemState(list,0,LVIS_SELECTED|LVIS_FOCUSED,LVIS_SELECTED|LVIS_FOCUSED); details(); }
    }
    void up() {
        if(directory.size()>3) { directory.pop_back(); auto slash=directory.find_last_of(L'\\'); directory.resize(slash+1); load(); }
    }
    void open() {
        if(!driveAvailable()||driveRoot!=viewRoot){directory=L"A:\\";load();return;}
        int i=ListView_GetNextItem(list,-1,LVNI_SELECTED);
        if(i<0 || static_cast<size_t>(i)>=entries.size()) return;
        auto file=childPath(i);
        if(entries[static_cast<size_t>(i)].attributes&FILE_ATTRIBUTE_DIRECTORY) { directory=file+L"\\"; load(); }
        else {
            // The OS association is used; CFAPI hydrates through the existing broker.
            SHELLEXECUTEINFOW action{sizeof(action)}; action.fMask=SEE_MASK_FLAG_NO_UI;
            action.hwnd=window; action.lpVerb=L"open"; action.lpFile=file.c_str(); action.nShow=SW_SHOWNORMAL;
            if(!ShellExecuteExW(&action)) SetWindowTextW(properties,L"Ouverture impossible. Vérifiez l’application associée, la connexion du lecteur A: et les droits dans ArchiOffice.");
        }
    }
    static LRESULT CALLBACK procedure(HWND hwnd,UINT msg,WPARAM wp,LPARAM lp) {
        auto self=reinterpret_cast<View*>(GetWindowLongPtrW(hwnd,GWLP_USERDATA));
        if(msg==WM_NCCREATE) { self=static_cast<View*>(reinterpret_cast<CREATESTRUCTW*>(lp)->lpCreateParams); self->window=hwnd; SetWindowLongPtrW(hwnd,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(self)); }
        if(!self) return DefWindowProcW(hwnd,msg,wp,lp);
        switch(msg) {
        case WM_TIMER:
            self->metadata();
            if(self->driveRoot!=self->viewRoot){self->directory=L"A:\\";self->load();}else self->details();
            return 0;
        case WM_SIZE: self->layout(); return 0;
        case WM_SETFOCUS: SetFocus(self->list); return 0;
        case WM_DPICHANGED_AFTERPARENT: self->layout(); return 0;
        case WM_COMMAND:
            if(LOWORD(wp)==101 && HIWORD(wp)==LBN_SELCHANGE) {
                int selected=static_cast<int>(SendMessageW(self->navigation,LB_GETCURSEL,0,0));
                if(selected==0) {self->directory=L"A:\\";self->load();} else if(selected==1) self->up(); else self->load();
                SetFocus(self->list);
            } return 0;
        case WM_NOTIFY: {
            auto header=reinterpret_cast<NMHDR*>(lp);
            if(header->hwndFrom==self->list) {
                if(header->code==LVN_ITEMCHANGED) self->details();
                if(header->code==NM_DBLCLK) self->open();
                if(header->code==LVN_KEYDOWN) {
                    auto key=reinterpret_cast<NMLVKEYDOWN*>(lp)->wVKey;
                    if(key==VK_RETURN) self->open();
                    else if(key==VK_BACK) self->up();
                    else if(key==VK_F5) self->load();
                }
            } return 0;
        }
        case WM_LBUTTONDOWN: {
            POINT point{static_cast<short>(LOWORD(lp)),static_cast<short>(HIWORD(lp))}; RECT a{},b{};
            GetWindowRect(self->navigation,&a); MapWindowPoints(nullptr,hwnd,reinterpret_cast<POINT*>(&a),2);
            GetWindowRect(self->properties,&b); MapWindowPoints(nullptr,hwnd,reinterpret_cast<POINT*>(&b),2);
            self->drag=point.x>=a.right && point.x<=a.right+self->scale(6) ? 1 : (point.x>=b.left-self->scale(6)&&point.x<=b.left ? 2 : 0);
            if(self->drag) SetCapture(hwnd); return 0;
        }
        case WM_MOUSEMOVE:
            if(self->drag) {
                RECT r{}; GetClientRect(hwnd,&r); int x=static_cast<short>(LOWORD(lp));
                int value=self->drag==1 ? x : r.right-x;
                value=MulDiv(value,96,GetDpiForWindow(hwnd));
                if(self->drag==1) self->left=std::clamp(value,120,360); else self->right=std::clamp(value,180,480);
                self->layout();
            } return 0;
        case WM_LBUTTONUP: self->drag=0; if(GetCapture()==hwnd) ReleaseCapture(); return 0;
        case WM_CAPTURECHANGED: self->drag=0; return 0;
        }
        return DefWindowProcW(hwnd,msg,wp,lp);
    }
public:
    View(){std::swprintf(windowClass,100,L"ArchiOfficeDrivePrototypeView-%p",static_cast<void*>(module));InterlockedIncrement(&objects);}
    ~View(){DestroyViewWindow();InterlockedDecrement(&objects);}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out) override {
        if(!out)return E_POINTER; *out=nullptr;
        if(id==IID_IUnknown||id==IID_IOleWindow||id==IID_IShellView)*out=static_cast<IShellView*>(this);
        if(!*out)return E_NOINTERFACE;AddRef();return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override{return InterlockedIncrement(&refs);}
    ULONG STDMETHODCALLTYPE Release() override{ULONG n=InterlockedDecrement(&refs);if(!n)delete this;return n;}
    HRESULT STDMETHODCALLTYPE GetWindow(HWND* out) override{if(!out)return E_POINTER;*out=window;return S_OK;}
    HRESULT STDMETHODCALLTYPE ContextSensitiveHelp(BOOL) override{return E_NOTIMPL;}
    HRESULT STDMETHODCALLTYPE TranslateAccelerator(MSG* msg) override {
        if(!msg)return E_POINTER;
        if(msg->message==WM_KEYDOWN) {
            if(msg->wParam==VK_F5){load();return S_OK;}
            if(msg->wParam==VK_TAB) {
                HWND controls[]={navigation,list,properties}; int i=0;while(i<3&&GetFocus()!=controls[i])++i;
                SetFocus(controls[(i+(GetKeyState(VK_SHIFT)<0?2:1))%3]);return S_OK;
            }
        }
        if(msg->message==WM_SYSKEYDOWN&&msg->wParam==VK_UP){up();return S_OK;}
        return S_FALSE;
    }
    HRESULT STDMETHODCALLTYPE EnableModeless(BOOL) override{return S_OK;}
    HRESULT STDMETHODCALLTYPE UIActivate(UINT state) override{
        if(state!=SVUIA_DEACTIVATE&&browser)browser->OnViewWindowActive(this);
        if(state==SVUIA_ACTIVATE_FOCUS)SetFocus(list);return S_OK;
    }
    HRESULT STDMETHODCALLTYPE Refresh() override{if(window)load();return S_OK;}
    HRESULT STDMETHODCALLTYPE CreateViewWindow(IShellView*,LPCFOLDERSETTINGS,IShellBrowser* host,RECT* rect,HWND* out) override {
        if(!host||!rect||!out)return E_POINTER;*out=nullptr;if(window)return E_UNEXPECTED;
        HWND parent=nullptr;HRESULT hr=host->GetWindow(&parent);if(FAILED(hr))return hr;
        browser=host;browser->AddRef();
        INITCOMMONCONTROLSEX init{sizeof(init),ICC_LISTVIEW_CLASSES};InitCommonControlsEx(&init);
        WNDCLASSW cls{};cls.lpfnWndProc=procedure;cls.hInstance=module;cls.lpszClassName=windowClass;cls.hCursor=LoadCursor(nullptr,IDC_ARROW);cls.hbrBackground=GetSysColorBrush(COLOR_BTNFACE);if(!RegisterClassW(&cls)) {
            DWORD error=GetLastError();WNDCLASSW registered{};
            if(error!=ERROR_CLASS_ALREADY_EXISTS || !GetClassInfoW(module,windowClass,&registered) || registered.lpfnWndProc!=procedure) {
                DestroyViewWindow();return HRESULT_FROM_WIN32(error);
            }
        }
        window=CreateWindowExW(0,cls.lpszClassName,L"ArchiOffice Drive",WS_CHILD|WS_VISIBLE|WS_CLIPCHILDREN,rect->left,rect->top,rect->right-rect->left,rect->bottom-rect->top,parent,nullptr,module,this);
        if(!window){DWORD error=GetLastError();DestroyViewWindow();return HRESULT_FROM_WIN32(error);}
        location=CreateWindowExW(0,L"STATIC",L"ArchiOffice Drive",WS_CHILD|WS_VISIBLE|SS_PATHELLIPSIS,0,0,0,0,window,nullptr,module,nullptr);
        navigation=CreateWindowExW(WS_EX_CLIENTEDGE,L"LISTBOX",L"Navigation",WS_CHILD|WS_VISIBLE|WS_TABSTOP|LBS_NOTIFY,0,0,0,0,window,reinterpret_cast<HMENU>(101),module,nullptr);
        for(auto label:{L"Projets dans A:",L"Dossier parent",L"Actualiser (F5)"})SendMessageW(navigation,LB_ADDSTRING,0,reinterpret_cast<LPARAM>(label));
        list=CreateWindowExW(WS_EX_CLIENTEDGE,WC_LISTVIEWW,L"Documents",WS_CHILD|WS_VISIBLE|WS_TABSTOP|LVS_REPORT|LVS_SINGLESEL|LVS_SHOWSELALWAYS,0,0,0,0,window,nullptr,module,nullptr);
        ListView_SetExtendedListViewStyle(list,LVS_EX_FULLROWSELECT|LVS_EX_DOUBLEBUFFER|LVS_EX_LABELTIP);
        properties=CreateWindowExW(WS_EX_CLIENTEDGE,L"EDIT",L"Propriétés",WS_CHILD|WS_VISIBLE|WS_TABSTOP|WS_VSCROLL|ES_MULTILINE|ES_READONLY|ES_AUTOVSCROLL,0,0,0,0,window,nullptr,module,nullptr);
        if(!location||!navigation||!list||!properties){DestroyViewWindow();return E_FAIL;}
        NONCLIENTMETRICSW metrics{sizeof(metrics)};if(SystemParametersInfoW(SPI_GETNONCLIENTMETRICS,sizeof(metrics),&metrics,0))font=CreateFontIndirectW(&metrics.lfMessageFont);
        for(HWND control:{location,navigation,list,properties})SendMessageW(control,WM_SETFONT,reinterpret_cast<WPARAM>(font?font:GetStockObject(DEFAULT_GUI_FONT)),TRUE);
        int column=0;for(auto label:{L"Document",L"Nature",L"Taille (octets)"}){LVCOLUMNW c{};c.mask=LVCF_TEXT|LVCF_WIDTH;c.pszText=const_cast<wchar_t*>(label);c.cx=scale(column==0?280:130);ListView_InsertColumn(list,column++,&c);}
        layout();load();SetTimer(window,1,5000,nullptr);*out=window;return S_OK;
    }
    HRESULT STDMETHODCALLTYPE DestroyViewWindow() override{
        if(window){DestroyWindow(window);window=nullptr;}
        navigation=list=properties=location=nullptr;
        // Fails harmlessly while another view of this module still has a window;
        // the final window unregisters it before the final COM object is released.
        UnregisterClassW(windowClass,module);
        if(font){DeleteObject(font);font=nullptr;}
        if(browser){auto old=browser;browser=nullptr;old->Release();}
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetCurrentInfo(LPFOLDERSETTINGS out) override{if(!out)return E_POINTER;out->ViewMode=FVM_DETAILS;out->fFlags=FWF_SINGLESEL;return S_OK;}
    HRESULT STDMETHODCALLTYPE AddPropertySheetPages(DWORD,LPFNSVADDPROPSHEETPAGE,LPARAM) override{return E_NOTIMPL;}
    HRESULT STDMETHODCALLTYPE SaveViewState() override{return S_OK;}
    HRESULT STDMETHODCALLTYPE SelectItem(PCUITEMID_CHILD,SVSIF) override{return E_NOTIMPL;}
    HRESULT STDMETHODCALLTYPE GetItemObject(UINT,REFIID,void** out) override{if(out)*out=nullptr;return E_NOINTERFACE;}
};

class DriveFolder final : public IShellFolder, public IPersistFolder2 {
    LONG refs=1; PIDLIST_ABSOLUTE pidl=nullptr;
public:
    DriveFolder(){InterlockedIncrement(&objects);}
    ~DriveFolder(){CoTaskMemFree(pidl);InterlockedDecrement(&objects);}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out) override {
        if(!out)return E_POINTER;*out=nullptr;
        if(id==IID_IUnknown||id==IID_IShellFolder)*out=static_cast<IShellFolder*>(this);
        else if(id==IID_IPersist||id==IID_IPersistFolder||id==IID_IPersistFolder2)*out=static_cast<IPersistFolder2*>(this);
        if(!*out)return E_NOINTERFACE;AddRef();return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override{return InterlockedIncrement(&refs);}
    ULONG STDMETHODCALLTYPE Release() override{ULONG n=InterlockedDecrement(&refs);if(!n)delete this;return n;}
    HRESULT STDMETHODCALLTYPE GetClassID(CLSID* out) override{if(!out)return E_POINTER;*out=CLSID_Drive;return S_OK;}
    HRESULT STDMETHODCALLTYPE Initialize(PCIDLIST_ABSOLUTE value) override{auto copy=ILCloneFull(value);if(!copy)return E_OUTOFMEMORY;CoTaskMemFree(pidl);pidl=copy;return S_OK;}
    HRESULT STDMETHODCALLTYPE GetCurFolder(PIDLIST_ABSOLUTE* out) override{if(!out)return E_POINTER;*out=ILCloneFull(pidl);return *out?S_OK:E_OUTOFMEMORY;}
    // This milestone exposes no virtual children to Explorer: navigation is owned
    // by IShellView, and operations always target the original filesystem paths.
    HRESULT STDMETHODCALLTYPE ParseDisplayName(HWND,IBindCtx*,LPWSTR,ULONG*,PIDLIST_RELATIVE* out,ULONG*) override{if(out)*out=nullptr;return E_NOTIMPL;}
    HRESULT STDMETHODCALLTYPE EnumObjects(HWND,SHCONTF,IEnumIDList** out) override{if(!out)return E_POINTER;*out=nullptr;return S_FALSE;}
    HRESULT STDMETHODCALLTYPE BindToObject(PCUIDLIST_RELATIVE,IBindCtx*,REFIID,void** out) override{if(out)*out=nullptr;return E_NOTIMPL;}
    HRESULT STDMETHODCALLTYPE BindToStorage(PCUIDLIST_RELATIVE,IBindCtx*,REFIID,void** out) override{if(out)*out=nullptr;return E_NOTIMPL;}
    HRESULT STDMETHODCALLTYPE CompareIDs(LPARAM,PCUIDLIST_RELATIVE,PCUIDLIST_RELATIVE) override{return E_NOTIMPL;}
    HRESULT STDMETHODCALLTYPE CreateViewObject(HWND,REFIID id,void** out) override{
        if(!out)return E_POINTER;*out=nullptr;if(id!=IID_IShellView)return E_NOINTERFACE;
        auto view=new(std::nothrow) View;if(!view)return E_OUTOFMEMORY;*out=static_cast<IShellView*>(view);return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetAttributesOf(UINT count,PCUITEMID_CHILD_ARRAY,SFGAOF* flags) override{if(!flags)return E_POINTER;if(count)return E_INVALIDARG;*flags&=SFGAO_FOLDER|SFGAO_BROWSABLE;return S_OK;}
    HRESULT STDMETHODCALLTYPE GetUIObjectOf(HWND,UINT,PCUITEMID_CHILD_ARRAY,REFIID,UINT*,void** out) override{if(out)*out=nullptr;return E_NOINTERFACE;}
    HRESULT STDMETHODCALLTYPE GetDisplayNameOf(PCUITEMID_CHILD,SHGDNF flags,STRRET* out) override{
        if(!out)return E_POINTER;std::wstring name=flags&SHGDN_FORPARSING?std::wstring(L"::")+ClassId:L"ArchiOffice Drive";
        out->uType=STRRET_WSTR;return SHStrDupW(name.c_str(),&out->pOleStr);
    }
    HRESULT STDMETHODCALLTYPE SetNameOf(HWND,PCUITEMID_CHILD,LPCWSTR,SHGDNF,PITEMID_CHILD* out) override{if(out)*out=nullptr;return E_ACCESSDENIED;}
};
class Factory final : public IClassFactory {
    LONG refs=1;
public:
    Factory(){InterlockedIncrement(&objects);} ~Factory(){InterlockedDecrement(&objects);}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out) override{if(!out)return E_POINTER;*out=nullptr;if(id!=IID_IUnknown&&id!=IID_IClassFactory)return E_NOINTERFACE;*out=this;AddRef();return S_OK;}
    ULONG STDMETHODCALLTYPE AddRef() override{return InterlockedIncrement(&refs);}
    ULONG STDMETHODCALLTYPE Release() override{ULONG n=InterlockedDecrement(&refs);if(!n)delete this;return n;}
    HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer,REFIID id,void** out) override{
        if(!out)return E_POINTER;*out=nullptr;if(outer)return CLASS_E_NOAGGREGATION;
        auto folder=new(std::nothrow) DriveFolder;if(!folder)return E_OUTOFMEMORY;auto hr=folder->QueryInterface(id,out);folder->Release();return hr;
    }
    HRESULT STDMETHODCALLTYPE LockServer(BOOL lock) override{if(lock)InterlockedIncrement(&objects);else InterlockedDecrement(&objects);return S_OK;}
};
extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID cls,REFIID id,void** out){if(!out)return E_POINTER;*out=nullptr;if(cls!=CLSID_Drive)return CLASS_E_CLASSNOTAVAILABLE;auto f=new(std::nothrow) Factory;if(!f)return E_OUTOFMEMORY;auto hr=f->QueryInterface(id,out);f->Release();return hr;}
extern "C" HRESULT __stdcall DllCanUnloadNow(){return objects==0?S_OK:S_FALSE;}
static std::wstring classKey(){return std::wstring(L"Software\\Classes\\CLSID\\")+ClassId;}
static std::wstring namespaceKey(){return std::wstring(L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Desktop\\NameSpace\\")+ClassId;}
static LSTATUS value(const std::wstring& key,const wchar_t* name,DWORD type,const void* data,DWORD size){return RegSetKeyValueW(HKEY_CURRENT_USER,key.c_str(),name,type,data,size);}
static LSTATUS stringValue(const std::wstring& key,const wchar_t* name,const std::wstring& text){return value(key,name,REG_SZ,text.c_str(),static_cast<DWORD>((text.size()+1)*sizeof(wchar_t)));}
extern "C" HRESULT __stdcall DllUnregisterServer(){
    auto a=RegDeleteTreeW(HKEY_CURRENT_USER,namespaceKey().c_str());auto b=RegDeleteTreeW(HKEY_CURRENT_USER,classKey().c_str());
    SHChangeNotify(SHCNE_ASSOCCHANGED,SHCNF_IDLIST,nullptr,nullptr);
    if(a!=ERROR_SUCCESS&&a!=ERROR_FILE_NOT_FOUND)return HRESULT_FROM_WIN32(a);
    return b==ERROR_SUCCESS||b==ERROR_FILE_NOT_FOUND?S_OK:HRESULT_FROM_WIN32(b);
}
extern "C" HRESULT __stdcall DllRegisterServer(){
    wchar_t file[32768]{};DWORD n=GetModuleFileNameW(module,file,32768);if(!n||n>=32768)return E_FAIL;
    auto key=classKey();LSTATUS result=stringValue(key,nullptr,L"ArchiOffice Drive");
    auto check=[&](LSTATUS code){if(result==ERROR_SUCCESS)result=code;};
    check(stringValue(key+L"\\InprocServer32",nullptr,file));check(stringValue(key+L"\\InprocServer32",L"ThreadingModel",L"Apartment"));
    DWORD pinned=1,attributes=SFGAO_FOLDER|SFGAO_BROWSABLE;
    check(value(key,L"System.IsPinnedToNameSpaceTree",REG_DWORD,&pinned,sizeof(pinned)));
    check(value(key+L"\\ShellFolder",L"Attributes",REG_DWORD,&attributes,sizeof(attributes)));
    check(stringValue(namespaceKey(),nullptr,L"ArchiOffice Drive"));
    if(result!=ERROR_SUCCESS){DllUnregisterServer();return HRESULT_FROM_WIN32(result);}
    SHChangeNotify(SHCNE_ASSOCCHANGED,SHCNF_IDLIST,nullptr,nullptr);return S_OK;
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH){module=instance;DisableThreadLibraryCalls(instance);}return TRUE;}
