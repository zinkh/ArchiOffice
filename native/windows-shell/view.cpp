#include "shell.hpp"
#include <uxtheme.h>
#include <windowsx.h>
#include <mutex>
#include <memory>
#include <optional>
#include <set>
#include <algorithm>
namespace {
std::atomic<UINT> serial{1};
struct Async {std::atomic<bool> stopped{false};std::mutex mutex;std::optional<Reply> reply;HWND window=nullptr;UINT serial=0;};
struct Job {std::shared_ptr<Async> state;std::wstring action,project,key,revision;HMODULE module=nullptr;};
DWORD WINAPI work(void* value){HMODULE module=nullptr;{
 std::unique_ptr<Job> job(static_cast<Job*>(value));module=job->module;
 try{winrt::init_apartment(winrt::apartment_type::multi_threaded);auto reply=request(job->action,job->project,job->key,job->revision);{std::lock_guard lock(job->state->mutex);job->state->reply=std::move(reply);}if(!job->state->stopped)PostMessageW(job->state->window,ResultMessage,job->state->serial,0);winrt::uninit_apartment();}catch(...){Reply failed;failed.message=L"Le client Drive est indisponible. Réessayez avec Actualiser.";{std::lock_guard lock(job->state->mutex);job->state->reply=std::move(failed);}if(!job->state->stopped)PostMessageW(job->state->window,ResultMessage,job->state->serial,0);}
 }objectCount--;FreeLibraryAndExitThread(module,0);
}
struct Filter {int project=-1;std::wstring phase;};
std::wstring status(std::wstring const& value){if(value==L"approuve")return L"Approuvé";if(value==L"en_cours")return L"En cours";if(value==L"perime")return L"Périmé";return value.empty()?L"—":value;}
}
class View final:public IShellView,public IFolderView {
 std::atomic<ULONG> refs{1};IShellFolder* folder;IShellBrowser* browser=nullptr;
 HWND window=nullptr,tree=nullptr,list=nullptr,details=nullptr,heading=nullptr,note=nullptr,refresh=nullptr,open=nullptr,document=nullptr;
 HFONT font=nullptr,titleFont=nullptr;int left=230,right=290,drag=0;bool busy=false,building=false;std::wstring action=L"catalog",selectedKey;Filter filter;
 std::vector<Project> projects;std::vector<Filter> filters;std::vector<std::pair<int,int>> visible;std::shared_ptr<Async> async;
 static LRESULT CALLBACK procedure(HWND hwnd,UINT msg,WPARAM w,LPARAM l){auto self=reinterpret_cast<View*>(GetWindowLongPtrW(hwnd,GWLP_USERDATA));if(msg==WM_NCCREATE){self=static_cast<View*>(reinterpret_cast<CREATESTRUCTW*>(l)->lpCreateParams);SetWindowLongPtrW(hwnd,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(self));self->window=hwnd;}if(self)return self->message(msg,w,l);return DefWindowProcW(hwnd,msg,w,l);}
 HWND control(wchar_t const* cls,wchar_t const* label,DWORD style,int id=0){auto child=CreateWindowExW(0,cls,label,WS_CHILD|WS_VISIBLE|style,0,0,10,10,window,reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)),moduleInstance,nullptr);SendMessageW(child,WM_SETFONT,reinterpret_cast<WPARAM>(font),TRUE);return child;}
 void layout(){RECT r;GetClientRect(window,&r);int width=r.right,height=r.bottom;int treeWidth=std::min(left,std::max(140,width/3)),detailWidth=width>=850?std::min(right,width/3):0;int center=std::max(120,width-treeWidth-detailWidth-32);
  MoveWindow(heading,18,10,std::max(100,width-36),28,TRUE);MoveWindow(refresh,16,46,110,30,TRUE);MoveWindow(open,136,46,100,30,TRUE);MoveWindow(document,246,46,190,30,TRUE);
  MoveWindow(tree,12,88,treeWidth-12,std::max(30,height-130),TRUE);MoveWindow(list,treeWidth+10,88,center,std::max(30,height-130),TRUE);
  ShowWindow(details,detailWidth?SW_SHOW:SW_HIDE);if(detailWidth)MoveWindow(details,width-detailWidth+4,88,detailWidth-18,std::max(30,height-130),TRUE);
  MoveWindow(note,16,std::max(110,height-32),std::max(100,width-32),24,TRUE);InvalidateRect(window,nullptr,TRUE);
 }
 void buttons(){bool valid=!busy&&ListView_GetNextItem(list,-1,LVNI_SELECTED)>=0;EnableWindow(refresh,!busy);EnableWindow(open,valid);EnableWindow(document,valid);}
 void selection(){int selected=ListView_GetNextItem(list,-1,LVNI_SELECTED);if(selected<0||selected>=static_cast<int>(visible.size())){SetWindowTextW(details,L"Sélectionnez un document pour afficher ses propriétés.");buttons();return;}auto [p,d]=visible[selected];auto const& project=projects[p];auto const& doc=project.rows[d];selectedKey=doc.key;
  auto content=doc.name+L"\r\n\r\nPROPRIÉTÉS\r\n\r\nProjet\r\n"+project.name+L"\r\n\r\nPhase\r\n"+(doc.phase.empty()?L"—":doc.phase)+L"\r\n\r\nType de fichier\r\n"+doc.type+L"\r\n\r\nIndice\r\n"+(doc.indice.empty()?L"—":doc.indice)+L"\r\n\r\nVersion\r\n"+std::to_wstring(doc.version)+L"\r\n\r\nStatut documentaire\r\n"+status(doc.status);
  SetWindowTextW(details,content.c_str());buttons();
 }
 void fill(){building=true;ListView_DeleteAllItems(list);visible.clear();int restore=-1;
  for(int p=0;p<static_cast<int>(projects.size());p++){if(filter.project>=0&&filter.project!=p)continue;for(int d=0;d<static_cast<int>(projects[p].rows.size());d++){auto const& doc=projects[p].rows[d];if(!filter.phase.empty()&&filter.phase!=doc.phase)continue;int index=static_cast<int>(visible.size());visible.emplace_back(p,d);LVITEMW item{};item.mask=LVIF_TEXT;item.iItem=index;item.pszText=const_cast<wchar_t*>(doc.name.c_str());ListView_InsertItem(list,&item);
   std::wstring fields[]={doc.phase.empty()?L"—":doc.phase,doc.type,doc.indice.empty()?L"—":doc.indice,std::to_wstring(doc.version),status(doc.status)};
   for(int col=0;col<5;col++)ListView_SetItemText(list,index,col+1,fields[col].data());if(doc.key==selectedKey)restore=index;
  }}building=false;if(restore<0&&!visible.empty())restore=0;if(restore>=0){ListView_SetItemState(list,restore,LVIS_SELECTED|LVIS_FOCUSED,LVIS_SELECTED|LVIS_FOCUSED);ListView_EnsureVisible(list,restore,FALSE);}selection();
 }
 HTREEITEM node(std::wstring const& label,HTREEITEM parent,Filter value){filters.push_back(value);TVINSERTSTRUCTW item{};item.hParent=parent;item.hInsertAfter=TVI_LAST;item.item.mask=TVIF_TEXT|TVIF_PARAM;item.item.pszText=const_cast<wchar_t*>(label.c_str());item.item.lParam=static_cast<LPARAM>(filters.size()-1);return TreeView_InsertItem(tree,&item);}
 void rebuild(){building=true;TreeView_DeleteAllItems(tree);filters.clear();auto root=node(L"Projets dans A:",TVI_ROOT,{});HTREEITEM target=root;
  for(int p=0;p<static_cast<int>(projects.size());p++){auto project=node(projects[p].name,root,{p,L""});if(filter.project==p&&filter.phase.empty())target=project;std::set<std::wstring> phases;for(auto const& doc:projects[p].rows)if(!doc.phase.empty())phases.insert(doc.phase);for(auto const& phase:phases){auto item=node(phase,project,{p,phase});if(filter.project==p&&filter.phase==phase)target=item;}TreeView_Expand(tree,project,TVE_EXPAND);}
  TreeView_Expand(tree,root,TVE_EXPAND);TreeView_SelectItem(tree,target);building=false;if(filter.project>=static_cast<int>(projects.size()))filter={};fill();
 }
 void launch(std::wstring requested){if(busy||!window)return;auto job=std::make_unique<Job>();job->state=async;job->action=requested;
  if(requested!=L"catalog"){int selected=ListView_GetNextItem(list,-1,LVNI_SELECTED);if(selected<0||selected>=static_cast<int>(visible.size()))return;auto [p,d]=visible[selected];job->project=projects[p].id;job->key=projects[p].rows[d].key;job->revision=projects[p].revision;}
  if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,reinterpret_cast<LPCWSTR>(&work),&job->module))return;
  busy=true;action=requested;buttons();SetWindowTextW(note,requested==L"catalog"?L"Vérification du catalogue Drive…":L"Ouverture du document…");objectCount++;auto module=job->module;HANDLE thread=CreateThread(nullptr,0,work,job.get(),0,nullptr);
  if(thread){job.release();CloseHandle(thread);}else{objectCount--;FreeLibrary(module);busy=false;buttons();}
 }
 LRESULT message(UINT msg,WPARAM w,LPARAM l){switch(msg){
  case WM_CREATE:{INITCOMMONCONTROLSEX init{sizeof(init),ICC_TREEVIEW_CLASSES|ICC_LISTVIEW_CLASSES};InitCommonControlsEx(&init);HDC dc=GetDC(window);auto dpi=GetDeviceCaps(dc,LOGPIXELSY);ReleaseDC(window,dc);font=CreateFontW(-MulDiv(10,dpi,72),0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");titleFont=CreateFontW(-MulDiv(16,dpi,72),0,0,0,FW_SEMIBOLD,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
   heading=control(L"STATIC",L"ArchiOffice Drive",SS_LEFT);SendMessageW(heading,WM_SETFONT,reinterpret_cast<WPARAM>(titleFont),TRUE);refresh=control(L"BUTTON",L"Actualiser",WS_TABSTOP,100);open=control(L"BUTTON",L"Ouvrir",WS_TABSTOP,101);document=control(L"BUTTON",L"Ouvrir dans ArchiOffice",WS_TABSTOP,102);
   tree=control(WC_TREEVIEWW,L"",WS_TABSTOP|TVS_HASBUTTONS|TVS_HASLINES|TVS_LINESATROOT|TVS_SHOWSELALWAYS,201);list=control(WC_LISTVIEWW,L"",WS_TABSTOP|LVS_REPORT|LVS_SINGLESEL|LVS_SHOWSELALWAYS,202);ListView_SetExtendedListViewStyle(list,LVS_EX_FULLROWSELECT|LVS_EX_DOUBLEBUFFER|LVS_EX_LABELTIP);
   wchar_t const* columns[]={L"Document",L"Phase",L"Type",L"Indice",L"Version",L"Statut"};int sizes[]={260,85,65,55,65,100};for(int i=0;i<6;i++){LVCOLUMNW c{};c.mask=LVCF_TEXT|LVCF_WIDTH;c.pszText=const_cast<wchar_t*>(columns[i]);c.cx=sizes[i];ListView_InsertColumn(list,i,&c);}
   details=control(L"EDIT",L"Sélectionnez un document pour afficher ses propriétés.",ES_MULTILINE|ES_READONLY|ES_AUTOVSCROLL|WS_VSCROLL|WS_TABSTOP,203);note=control(L"STATIC",L"",SS_LEFT);SetWindowTheme(tree,L"Explorer",nullptr);SetWindowTheme(list,L"Explorer",nullptr);
   async=std::make_shared<Async>();async->window=window;async->serial=serial++;SetTimer(window,1,5000,nullptr);layout();launch(L"catalog");return 0;}
  case WM_SIZE:layout();return 0;
  case WM_COMMAND:if(LOWORD(w)==100)launch(L"catalog");if(LOWORD(w)==101)launch(L"open");if(LOWORD(w)==102)launch(L"document");return 0;
  case WM_NOTIFY:{auto info=reinterpret_cast<NMHDR*>(l);if(info->hwndFrom==tree&&info->code==TVN_SELCHANGEDW&&!building){auto n=reinterpret_cast<NMTREEVIEWW*>(l);auto index=static_cast<size_t>(n->itemNew.lParam);if(index<filters.size()){filter=filters[index];selectedKey.clear();fill();}}if(info->hwndFrom==list&&!building){if(info->code==LVN_ITEMCHANGED)selection();if(info->code==NM_DBLCLK)launch(L"open");if(info->code==LVN_KEYDOWN&&reinterpret_cast<NMLVKEYDOWN*>(l)->wVKey==VK_RETURN)launch(L"open");}return 0;}
  case WM_TIMER:if(w==1)launch(L"catalog");return 0;
  case ResultMessage:{if(!async||w!=async->serial)return 0;std::optional<Reply> reply;{std::lock_guard lock(async->mutex);reply=std::move(async->reply);async->reply.reset();}busy=false;if(reply){SetWindowTextW(note,reply->message.c_str());if(action==L"catalog"){projects=std::move(reply->projects);if(!reply->ok){filter={};selectedKey.clear();}rebuild();}}buttons();return 0;}
  case WM_SETFOCUS:if(browser)browser->OnViewWindowActive(this);SetFocus(list);return 0;
  case WM_LBUTTONDOWN:{int x=GET_X_LPARAM(l);RECT r;GetClientRect(window,&r);if(abs(x-left)<10)drag=1;else if(abs(x-(r.right-right))<10)drag=2;if(drag)SetCapture(window);return 0;}
  case WM_MOUSEMOVE:if(drag){RECT r;GetClientRect(window,&r);int x=GET_X_LPARAM(l),width=static_cast<int>(r.right);if(drag==1)left=std::clamp(x,160,std::max(160,width/3));else right=std::clamp(width-x,220,std::max(220,width/3));layout();}return 0;
  case WM_LBUTTONUP:drag=0;if(GetCapture()==window)ReleaseCapture();return 0;
  case WM_DESTROY:KillTimer(window,1);if(async)async->stopped=true;return 0;
  case WM_NCDESTROY:SetWindowLongPtrW(window,GWLP_USERDATA,0);window=nullptr;return 0;
 }return DefWindowProcW(window,msg,w,l);}
public:
 explicit View(IShellFolder* owner):folder(owner){folder->AddRef();objectCount++;}~View(){if(window)DestroyWindow(window);if(font)DeleteObject(font);if(titleFont)DeleteObject(titleFont);if(browser)browser->Release();folder->Release();objectCount--;}
 HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(id==IID_IUnknown||id==IID_IOleWindow||id==IID_IShellView)*out=static_cast<IShellView*>(this);else if(id==IID_IFolderView)*out=static_cast<IFolderView*>(this);else return E_NOINTERFACE;AddRef();return S_OK;}
 ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}ULONG STDMETHODCALLTYPE Release()override{auto n=--refs;if(!n)delete this;return n;}
 HRESULT STDMETHODCALLTYPE GetWindow(HWND* out)override{if(!out)return E_POINTER;*out=window;return S_OK;}
 HRESULT STDMETHODCALLTYPE ContextSensitiveHelp(BOOL)override{return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE TranslateAccelerator(MSG* msg)override{if(!msg)return E_POINTER;if(msg->message==WM_KEYDOWN&&msg->wParam==VK_F5){launch(L"catalog");return S_OK;}return window&&IsDialogMessageW(window,msg)?S_OK:S_FALSE;}
 HRESULT STDMETHODCALLTYPE EnableModeless(BOOL)override{return S_OK;}
 HRESULT STDMETHODCALLTYPE UIActivate(UINT state)override{if(state!=SVUIA_DEACTIVATE&&browser)browser->OnViewWindowActive(this);return S_OK;}
 HRESULT STDMETHODCALLTYPE Refresh()override{launch(L"catalog");return S_OK;}
 HRESULT STDMETHODCALLTYPE CreateViewWindow(IShellView*,LPCFOLDERSETTINGS,IShellBrowser* host,RECT* rect,HWND* out)override{if(!host||!rect||!out)return E_POINTER;*out=nullptr;if(window)return E_UNEXPECTED;HWND parent;auto hr=host->GetWindow(&parent);if(FAILED(hr))return hr;browser=host;browser->AddRef();WNDCLASSW cls{};cls.lpfnWndProc=procedure;cls.hInstance=moduleInstance;cls.hCursor=LoadCursorW(nullptr,IDC_ARROW);cls.hbrBackground=reinterpret_cast<HBRUSH>(COLOR_WINDOW+1);cls.lpszClassName=ViewClass;RegisterClassW(&cls);
  *out=CreateWindowExW(WS_EX_CONTROLPARENT,ViewClass,L"ArchiOffice Drive",WS_CHILD|WS_VISIBLE|WS_CLIPCHILDREN,rect->left,rect->top,rect->right-rect->left,rect->bottom-rect->top,parent,nullptr,moduleInstance,this);return *out?S_OK:HRESULT_FROM_WIN32(GetLastError());}
 HRESULT STDMETHODCALLTYPE DestroyViewWindow()override{if(window)DestroyWindow(window);return S_OK;}
 HRESULT STDMETHODCALLTYPE GetCurrentInfo(LPFOLDERSETTINGS info)override{if(!info)return E_POINTER;info->ViewMode=FVM_DETAILS;info->fFlags=FWF_AUTOARRANGE;return S_OK;}
 HRESULT STDMETHODCALLTYPE AddPropertySheetPages(DWORD,LPFNSVADDPROPSHEETPAGE,LPARAM)override{return S_OK;}
 HRESULT STDMETHODCALLTYPE SaveViewState()override{return S_OK;}
 HRESULT STDMETHODCALLTYPE SelectItem(PCUITEMID_CHILD,SVSIF)override{return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE GetItemObject(UINT,REFIID,void** out)override{if(out)*out=nullptr;return E_NOINTERFACE;}
 HRESULT STDMETHODCALLTYPE GetCurrentViewMode(UINT* mode)override{if(!mode)return E_POINTER;*mode=FVM_DETAILS;return S_OK;}
 HRESULT STDMETHODCALLTYPE SetCurrentViewMode(UINT)override{return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE GetFolder(REFIID iid,void** out)override{return folder->QueryInterface(iid,out);}
 HRESULT STDMETHODCALLTYPE Item(int,PITEMID_CHILD* out)override{if(out)*out=nullptr;return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE ItemCount(UINT,int* count)override{if(!count)return E_POINTER;*count=static_cast<int>(visible.size());return S_OK;}
 HRESULT STDMETHODCALLTYPE Items(UINT,REFIID,void** out)override{if(out)*out=nullptr;return E_NOINTERFACE;}
 HRESULT STDMETHODCALLTYPE GetSelectionMarkedItem(int* item)override{if(!item)return E_POINTER;*item=ListView_GetNextItem(list,-1,LVNI_SELECTED);return *item>=0?S_OK:S_FALSE;}
 HRESULT STDMETHODCALLTYPE GetFocusedItem(int* item)override{if(!item)return E_POINTER;*item=ListView_GetNextItem(list,-1,LVNI_FOCUSED);return *item>=0?S_OK:S_FALSE;}
 HRESULT STDMETHODCALLTYPE GetItemPosition(PCUITEMID_CHILD,POINT*)override{return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE GetSpacing(POINT* p)override{if(!p)return E_POINTER;*p={0,0};return S_OK;}
 HRESULT STDMETHODCALLTYPE GetDefaultSpacing(POINT* p)override{return GetSpacing(p);}
 HRESULT STDMETHODCALLTYPE GetAutoArrange()override{return S_FALSE;}
 HRESULT STDMETHODCALLTYPE SelectItem(int item,DWORD flags)override{ListView_SetItemState(list,item,flags&SVSI_SELECT?LVIS_SELECTED|LVIS_FOCUSED:0,LVIS_SELECTED|LVIS_FOCUSED);return S_OK;}
 HRESULT STDMETHODCALLTYPE SelectAndPositionItems(UINT,PCUITEMID_CHILD_ARRAY,POINT*,DWORD)override{return E_NOTIMPL;}
};
HRESULT createView(IShellFolder* owner,REFIID iid,void** out){if(!out)return E_POINTER;auto view=new(std::nothrow)View(owner);if(!view){*out=nullptr;return E_OUTOFMEMORY;}auto hr=view->QueryInterface(iid,out);view->Release();return hr;}
