#include <initguid.h>
#include "shell.hpp"
#include "navigation.hpp"
#include <cwchar>
#include <uxtheme.h>
#include <windowsx.h>
#include <mutex>
#include <memory>
#include <optional>
#include <set>
#include <algorithm>
#include <oleacc.h>
namespace {
std::atomic<UINT> serial{1};
struct Async {std::atomic<bool> stopped{false};std::mutex mutex;std::optional<Reply> reply;HWND window=nullptr;UINT serial=0;};
struct Job {std::shared_ptr<Async> state;std::wstring action,project,key,revision;HMODULE module=nullptr;};
DWORD WINAPI work(void* value){HMODULE module=nullptr;{
 std::unique_ptr<Job> job(static_cast<Job*>(value));module=job->module;
 try{winrt::init_apartment(winrt::apartment_type::multi_threaded);auto reply=request(job->action,job->project,job->key,job->revision);{std::lock_guard lock(job->state->mutex);job->state->reply=std::move(reply);}if(!job->state->stopped)PostMessageW(job->state->window,ResultMessage,job->state->serial,0);winrt::uninit_apartment();}catch(...){Reply failed;failed.message=L"Le client Drive est indisponible. Réessayez avec Actualiser.";{std::lock_guard lock(job->state->mutex);job->state->reply=std::move(failed);}if(!job->state->stopped)PostMessageW(job->state->window,ResultMessage,job->state->serial,0);}
 }objectCount--;FreeLibraryAndExitThread(module,0);
}

std::wstring status(std::wstring const& value){if(value==L"approuve")return L"Approuvé";if(value==L"en_cours")return L"En cours";if(value==L"perime")return L"Périmé";return value.empty()?L"—":value;}
}
class View final:public IShellView,public IFolderView {
 std::atomic<ULONG> refs{1};IShellFolder* folder;IShellBrowser* browser=nullptr;
 HWND window=nullptr,tree=nullptr,list=nullptr,details=nullptr,heading=nullptr,note=nullptr,refresh=nullptr,open=nullptr,document=nullptr,properties=nullptr,search=nullptr,projectFilter=nullptr,phaseFilter=nullptr,typeFilter=nullptr,statusFilter=nullptr,reset=nullptr;
 HFONT font=nullptr,titleFont=nullptr;UINT dpi=96;int left=230,right=290,drag=0,splitLeft=230,splitRight=0;bool catalogLoaded=false,busy=false,building=false,propertiesMode=false;std::set<std::wstring> collapsedProjects;std::wstring action=L"catalog",selectedKey,scope;Filter filter;std::set<ViewKind> collapsedRoots;wchar_t className[100]{};
 std::vector<std::wstring> projectOptions,phaseOptions,typeOptions,statusOptions;
 std::vector<Project> projects;std::vector<Filter> filters;std::vector<std::pair<int,int>> visible;std::shared_ptr<Async> async;
 static LRESULT CALLBACK procedure(HWND hwnd,UINT msg,WPARAM w,LPARAM l){auto self=reinterpret_cast<View*>(GetWindowLongPtrW(hwnd,GWLP_USERDATA));if(msg==WM_NCCREATE){self=static_cast<View*>(reinterpret_cast<CREATESTRUCTW*>(l)->lpCreateParams);SetWindowLongPtrW(hwnd,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(self));self->window=hwnd;}if(self)return self->message(msg,w,l);return DefWindowProcW(hwnd,msg,w,l);}
 HWND control(wchar_t const* cls,wchar_t const* label,DWORD style,int id=0){auto child=CreateWindowExW(0,cls,label,WS_CHILD|WS_VISIBLE|style,0,0,10,10,window,reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)),moduleInstance,nullptr);SendMessageW(child,WM_SETFONT,reinterpret_cast<WPARAM>(font),TRUE);return child;}
 int px(int value)const{return MulDiv(value,dpi,96);}
 int dip(int value)const{return MulDiv(value,96,dpi);}
 void place(HWND child,int x,int y,int width,int height){MoveWindow(child,px(x),px(y),px(width),px(height),TRUE);}
 void scale(UINT supplied=0){
  dpi=supplied?supplied:GetDpiForWindow(window);if(!dpi)dpi=96;
  auto previous=font,previousTitle=titleFont;
  font=CreateFontW(-MulDiv(10,dpi,72),0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
  titleFont=CreateFontW(-MulDiv(16,dpi,72),0,0,0,FW_SEMIBOLD,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
  for(auto child:{tree,list,details,note,refresh,open,document,properties,search,projectFilter,phaseFilter,typeFilter,statusFilter,reset})SendMessageW(child,WM_SETFONT,reinterpret_cast<WPARAM>(font),TRUE);
  SendMessageW(heading,WM_SETFONT,reinterpret_cast<WPARAM>(titleFont),TRUE);
  if(previous)DeleteObject(previous);if(previousTitle)DeleteObject(previousTitle);
  int widths[]={260,85,65,55,65,100};for(int col=0;col<6;col++)ListView_SetColumnWidth(list,col,px(widths[col]));TreeView_SetItemHeight(tree,px(25));
 }
 void name(HWND child,wchar_t const* label){
  winrt::com_ptr<IAccPropServices> service;
  if(SUCCEEDED(CoCreateInstance(CLSID_AccPropServices,nullptr,CLSCTX_INPROC_SERVER,IID_IAccPropServices,service.put_void()))){if(label)service->SetHwndPropStr(child,static_cast<DWORD>(OBJID_CLIENT),CHILDID_SELF,PROPID_ACC_NAME,label);else{MSAAPROPID property=PROPID_ACC_NAME;service->ClearHwndProps(child,static_cast<DWORD>(OBJID_CLIENT),CHILDID_SELF,&property,1);}}
 }
 void layout(){RECT r;GetClientRect(window,&r);int width=dip(r.right),height=dip(r.bottom);
  int treeWidth=std::min(left,std::max(100,width/3)),detailWidth=width>=850?std::min(right,width/3):0;
  splitLeft=treeWidth;splitRight=detailWidth?width-detailWidth:0;
  place(heading,18,10,std::max(100,width-36),28);
  ShowWindow(properties,detailWidth?SW_HIDE:SW_SHOW);SetWindowTextW(properties,propertiesMode?L"Documents":L"Propriétés");
  int x=16,y=46;struct Button{HWND window;int width;};
  for(auto button:{Button{refresh,110},Button{open,100},Button{document,190},Button{properties,125}}){if(button.window==properties&&detailWidth)continue;if(x+button.width>width-16&&x>16){x=16;y+=36;}place(button.window,x,y,button.width,30);x+=button.width+10;}
  int searchY=y+40;place(search,16,searchY,std::max(80,width-152),28);place(reset,std::max(104,width-126),searchY,110,28);
  int columns=width>=1000?4:2,filterY=searchY+36,cell=(width-32-(columns-1)*8)/columns;
  HWND choices[]={projectFilter,phaseFilter,typeFilter,statusFilter};for(int i=0;i<4;i++)place(choices[i],16+(i%columns)*(cell+8),filterY+(i/columns)*36,cell,210);
  int top=filterY+((4+columns-1)/columns)*36+8,body=std::max(30,height-top-64),center=std::max(100,width-treeWidth-detailWidth-32);
  place(tree,12,top,treeWidth-12,body);
  bool alternate=!detailWidth&&propertiesMode;ShowWindow(list,alternate?SW_HIDE:SW_SHOW);ShowWindow(details,detailWidth||alternate?SW_SHOW:SW_HIDE);
  place(list,treeWidth+10,top,center,body);
  if(detailWidth)place(details,width-detailWidth+4,top,detailWidth-18,body);else if(alternate)place(details,treeWidth+10,top,center,body);
  place(note,16,std::max(110,height-54),std::max(100,width-32),46);InvalidateRect(window,nullptr,TRUE);
 }
 void buttons(){bool valid=!busy&&ListView_GetNextItem(list,-1,LVNI_SELECTED)>=0;EnableWindow(refresh,!busy);EnableWindow(open,valid);EnableWindow(document,valid);}
 void selection(){int selected=ListView_GetNextItem(list,-1,LVNI_SELECTED);if(selected<0||selected>=static_cast<int>(visible.size())){SetWindowTextW(details,L"Sélectionnez un document pour afficher ses propriétés.");buttons();return;}auto [p,d]=visible[selected];auto const& project=projects[p];auto const& doc=project.rows[d];selectedKey=doc.key;
  auto content=doc.name+L"\r\n\r\nPROPRIÉTÉS\r\n\r\nProjet\r\n"+project.name+L"\r\n\r\nPhase\r\n"+(doc.phase.empty()?L"—":doc.phase)+L"\r\n\r\nType documentaire\r\n"+(doc.type.empty()?L"Non renseigné ou indisponible":doc.type)+L"\r\n\r\nFormat\r\n"+doc.fileType+L"\r\n\r\nIndice\r\n"+(doc.indice.empty()?L"—":doc.indice)+L"\r\n\r\nVersion\r\n"+std::to_wstring(doc.version)+L"\r\n\r\nStatut documentaire\r\n"+status(doc.status);
  if(doc.businessKnown){content+=L"\r\n\r\nMétadonnées observées le\r\n"+(doc.metadataDate.empty()?std::wstring(L"Date indisponible"):doc.metadataDate);if(doc.metadataStale)content+=L"\r\nInformations en cache, actualisation en attente.";}
  content+=L"\r\n\r\nDisponibilité locale\r\n"+std::wstring(doc.available==1?L"Contenu entièrement présent":doc.available==0?L"Contenu à télécharger":L"Indisponible");
  SetWindowTextW(details,content.c_str());buttons();
 }
 void fill(bool preserveScroll=false){int top=preserveScroll?ListView_GetTopIndex(list):0;building=true;ListView_DeleteAllItems(list);visible.clear();int restore=-1;
  for(int p=0;p<static_cast<int>(projects.size());p++){for(int d=0;d<static_cast<int>(projects[p].rows.size());d++){auto const& doc=projects[p].rows[d];if(!matches(filter,projects[p],doc))continue;int index=static_cast<int>(visible.size());visible.emplace_back(p,d);LVITEMW item{};item.mask=LVIF_TEXT;item.iItem=index;item.pszText=const_cast<wchar_t*>(doc.name.c_str());ListView_InsertItem(list,&item);
   std::wstring fields[]={doc.phase.empty()?L"—":doc.phase,doc.type.empty()?L"—":doc.type,doc.indice.empty()?L"—":doc.indice,std::to_wstring(doc.version),status(doc.status)};
   for(int col=0;col<5;col++)ListView_SetItemText(list,index,col+1,fields[col].data());if(doc.key==selectedKey)restore=index;
  }}building=false;if(restore<0&&!visible.empty())restore=0;if(restore>=0){ListView_SetItemState(list,restore,LVIS_SELECTED|LVIS_FOCUSED,LVIS_SELECTED|LVIS_FOCUSED);if(!preserveScroll)ListView_EnsureVisible(list,restore,FALSE);}if(preserveScroll&&top>0&&!visible.empty()){RECT item{};if(ListView_GetItemRect(list,0,&item,LVIR_BOUNDS))ListView_Scroll(list,0,std::min(top,static_cast<int>(visible.size())-1)*(item.bottom-item.top));}selection();caption();
 }
 HTREEITEM node(std::wstring const& label,HTREEITEM parent,Filter value){filters.push_back(value);TVINSERTSTRUCTW item{};item.hParent=parent;item.hInsertAfter=TVI_LAST;item.item.mask=TVIF_TEXT|TVIF_PARAM;item.item.pszText=const_cast<wchar_t*>(label.c_str());item.item.lParam=static_cast<LPARAM>(filters.size()-1);return TreeView_InsertItem(tree,&item);}
 void caption(){
  std::wstring text=std::to_wstring(visible.size())+L" document(s) · Projets de A:";
  if(filter.kind==ViewKind::Unclassified)text+=L" · Sans phase/type renseigné (métadonnées vérifiées)";
  if(filter.kind==ViewKind::Offline)text+=L" · Contenu entièrement disponible sur le poste";
  if(filter.kind==ViewKind::Conflict)text+=L" · Conflits signalés par la file d’envoi";
  int unknown=0;for(auto const& p:projects)for(auto const& d:p.rows)if((filter.kind==ViewKind::Offline&&d.available<0)||(filter.kind==ViewKind::Conflict&&d.transferState.empty())||(filter.kind==ViewKind::Unclassified&&!d.businessKnown))++unknown;
  if(unknown)text+=L" · "+std::to_wstring(unknown)+L" état(s) indisponible(s) dans le catalogue";
  if(visible.empty())text=L"Aucun document ne correspond aux critères. "+text;
  SetWindowTextW(note,text.c_str());
 }
 void choices(HWND combo,std::vector<std::wstring>& values,std::vector<std::pair<std::wstring,std::wstring>> options,std::wstring const& selected,wchar_t const* all){
  SendMessageW(combo,CB_RESETCONTENT,0,0);values={L""};SendMessageW(combo,CB_ADDSTRING,0,reinterpret_cast<LPARAM>(all));int target=0;
  for(auto const& option:options){if(option.first.empty())continue;values.push_back(option.first);SendMessageW(combo,CB_ADDSTRING,0,reinterpret_cast<LPARAM>(option.second.c_str()));if(option.first==selected)target=static_cast<int>(values.size()-1);}
  if(!selected.empty()&&!target){values.push_back(selected);auto label=selected+L" (absent du catalogue)";SendMessageW(combo,CB_ADDSTRING,0,reinterpret_cast<LPARAM>(label.c_str()));target=static_cast<int>(values.size()-1);}
  SendMessageW(combo,CB_SETCURSEL,target,0);
 }
 void rebuild(bool preserveScroll=false){
  int treeTop=preserveScroll?GetScrollPos(tree,SB_VERT):0;building=true;TreeView_DeleteAllItems(tree);filters.clear();
  auto root=node(L"Par projet",TVI_ROOT,{ViewKind::Project});HTREEITEM target=root;std::set<std::wstring> phases,types,states;
  std::vector<std::pair<std::wstring,std::wstring>> projectChoices;
  auto selected=[&](HTREEITEM item,Filter const& f){if(filter.kind==f.kind&&filter.value==f.value&&filter.scopeProject==f.scopeProject)target=item;};
  for(auto const& p:projects){Filter f{ViewKind::Project,p.id};auto project=node(p.name,root,f);selected(project,f);projectChoices.emplace_back(p.id,p.name);std::set<std::wstring> local;
   for(auto const& doc:p.rows){if(!doc.phase.empty()){phases.insert(doc.phase);local.insert(doc.phase);}if(!doc.type.empty())types.insert(doc.type);if(!doc.status.empty())states.insert(doc.status);}
   for(auto const& phase:local){Filter leaf{ViewKind::Phase,phase};leaf.scopeProject=p.id;auto item=node(phase,project,leaf);selected(item,leaf);}if(!collapsedProjects.contains(p.id))TreeView_Expand(tree,project,TVE_EXPAND);
  }
  auto phaseRoot=node(L"Par phase",TVI_ROOT,{ViewKind::Phase});selected(phaseRoot,{ViewKind::Phase});
  for(auto const& phase:phases){Filter f{ViewKind::Phase,phase};auto item=node(phase,phaseRoot,f);selected(item,f);}
  auto typeRoot=node(L"Par type",TVI_ROOT,{ViewKind::Type});selected(typeRoot,{ViewKind::Type});
  for(auto const& type:types){Filter f{ViewKind::Type,type};auto item=node(type,typeRoot,f);selected(item,f);}
  for(auto const& pair:std::vector<std::pair<std::wstring,ViewKind>>{{L"À classer",ViewKind::Unclassified},{L"Hors ligne",ViewKind::Offline},{L"Conflits",ViewKind::Conflict}}){Filter f{pair.second};auto item=node(pair.first,TVI_ROOT,f);selected(item,f);}
  if(!collapsedRoots.contains(ViewKind::Project))TreeView_Expand(tree,root,TVE_EXPAND);
  if(!collapsedRoots.contains(ViewKind::Phase))TreeView_Expand(tree,phaseRoot,TVE_EXPAND);
  if(!collapsedRoots.contains(ViewKind::Type))TreeView_Expand(tree,typeRoot,TVE_EXPAND);
  auto options=[](std::set<std::wstring> const& values,bool statusLabels=false){std::vector<std::pair<std::wstring,std::wstring>> result;for(auto const& value:values)result.emplace_back(value,statusLabels?status(value):value);return result;};
  choices(projectFilter,projectOptions,projectChoices,filter.project,L"Tous les projets");choices(phaseFilter,phaseOptions,options(phases),filter.phase,L"Toutes les phases");choices(typeFilter,typeOptions,options(types),filter.type,L"Tous les types");choices(statusFilter,statusOptions,options(states,true),filter.status,L"Tous les statuts");
  TreeView_SelectItem(tree,target);if(treeTop)SendMessageW(tree,WM_VSCROLL,MAKEWPARAM(SB_THUMBPOSITION,treeTop),0);building=false;fill(preserveScroll);
 }
 void choose(HWND combo,std::vector<std::wstring> const& options,std::wstring& value){auto index=static_cast<size_t>(SendMessageW(combo,CB_GETCURSEL,0,0));if(index<options.size())value=options[index];fill();}
 void launch(std::wstring requested){if(busy||!window)return;auto job=std::make_unique<Job>();job->state=async;job->action=requested;
  if(requested!=L"catalog"){int selected=ListView_GetNextItem(list,-1,LVNI_SELECTED);if(selected<0||selected>=static_cast<int>(visible.size()))return;auto [p,d]=visible[selected];job->project=projects[p].id;job->key=projects[p].rows[d].key;job->revision=projects[p].revision;}
  if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,reinterpret_cast<LPCWSTR>(&work),&job->module))return;
  busy=true;action=requested;buttons();SetWindowTextW(note,requested==L"catalog"?L"Vérification du catalogue Drive…":L"Ouverture du document…");objectCount++;auto module=job->module;HANDLE thread=CreateThread(nullptr,0,work,job.get(),0,nullptr);
  if(thread){job.release();CloseHandle(thread);}else{objectCount--;FreeLibrary(module);busy=false;buttons();}
 }
 LRESULT message(UINT msg,WPARAM w,LPARAM l){switch(msg){
  case WM_CREATE:{INITCOMMONCONTROLSEX init{sizeof(init),ICC_TREEVIEW_CLASSES|ICC_LISTVIEW_CLASSES};InitCommonControlsEx(&init);
   heading=control(L"STATIC",L"ArchiOffice Drive",SS_LEFT);refresh=control(L"BUTTON",L"Actualiser",WS_TABSTOP,100);open=control(L"BUTTON",L"Ouvrir",WS_TABSTOP,101);document=control(L"BUTTON",L"Ouvrir dans ArchiOffice",WS_TABSTOP,102);properties=control(L"BUTTON",L"Propriétés",WS_TABSTOP,103);
   search=control(L"EDIT",L"",WS_TABSTOP|ES_AUTOHSCROLL|WS_BORDER,210);SendMessageW(search,EM_SETLIMITTEXT,256,0);SendMessageW(search,EM_SETCUEBANNER,TRUE,reinterpret_cast<LPARAM>(L"Rechercher un document…"));
   reset=control(L"BUTTON",L"Effacer",WS_TABSTOP,215);
   projectFilter=control(L"COMBOBOX",L"",WS_TABSTOP|CBS_DROPDOWNLIST|WS_VSCROLL,211);phaseFilter=control(L"COMBOBOX",L"",WS_TABSTOP|CBS_DROPDOWNLIST|WS_VSCROLL,212);typeFilter=control(L"COMBOBOX",L"",WS_TABSTOP|CBS_DROPDOWNLIST|WS_VSCROLL,213);statusFilter=control(L"COMBOBOX",L"",WS_TABSTOP|CBS_DROPDOWNLIST|WS_VSCROLL,214);
   tree=control(WC_TREEVIEWW,L"",WS_TABSTOP|TVS_HASBUTTONS|TVS_HASLINES|TVS_LINESATROOT|TVS_SHOWSELALWAYS,201);list=control(WC_LISTVIEWW,L"",WS_TABSTOP|LVS_REPORT|LVS_SINGLESEL|LVS_SHOWSELALWAYS,202);ListView_SetExtendedListViewStyle(list,LVS_EX_FULLROWSELECT|LVS_EX_DOUBLEBUFFER|LVS_EX_LABELTIP);
   wchar_t const* columns[]={L"Document",L"Phase",L"Type",L"Indice",L"Version",L"Statut"};int sizes[]={260,85,65,55,65,100};for(int i=0;i<6;i++){LVCOLUMNW c{};c.mask=LVCF_TEXT|LVCF_WIDTH;c.pszText=const_cast<wchar_t*>(columns[i]);c.cx=sizes[i];ListView_InsertColumn(list,i,&c);}
   details=control(L"EDIT",L"Sélectionnez un document pour afficher ses propriétés.",ES_MULTILINE|ES_READONLY|ES_AUTOVSCROLL|WS_VSCROLL|WS_TABSTOP,203);note=control(L"STATIC",L"",SS_LEFT);scale();name(tree,L"Navigation documentaire");name(list,L"Documents du projet");name(details,L"Propriétés du document, lecture seule");name(search,L"Rechercher dans les documents montés");name(projectFilter,L"Filtrer par projet");name(phaseFilter,L"Filtrer par phase");name(typeFilter,L"Filtrer par type documentaire");name(statusFilter,L"Filtrer par statut");SetWindowTheme(tree,L"Explorer",nullptr);SetWindowTheme(list,L"Explorer",nullptr);
   async=std::make_shared<Async>();async->window=window;async->serial=serial++;SetTimer(window,1,5000,nullptr);layout();rebuild();launch(L"catalog");return 0;}
  case WM_SIZE:layout();return 0;
  case WM_DPICHANGED:scale(HIWORD(w));layout();return 0;
  case WM_DPICHANGED_AFTERPARENT:scale();layout();return 0;
  case WM_PAINT:{PAINTSTRUCT paint;HDC dc=BeginPaint(window,&paint);RECT r;GetClientRect(window,&r);auto pen=CreatePen(PS_SOLID,1,GetSysColor(COLOR_3DSHADOW));auto old=SelectObject(dc,pen);for(int divider:{splitLeft,splitRight})if(divider){MoveToEx(dc,px(divider+4),px(88),nullptr);LineTo(dc,px(divider+4),r.bottom-px(42));}SelectObject(dc,old);DeleteObject(pen);EndPaint(window,&paint);return 0;}
  case WM_SETCURSOR:if(LOWORD(l)==HTCLIENT){POINT point;GetCursorPos(&point);ScreenToClient(window,&point);int x=dip(point.x);if(abs(x-splitLeft-4)<6||(splitRight&&abs(x-splitRight-4)<6)){SetCursor(LoadCursorW(nullptr,IDC_SIZEWE));return TRUE;}}break;
  case WM_COMMAND:
   if(building)return 0;
   if(LOWORD(w)==210&&HIWORD(w)==EN_CHANGE){KillTimer(window,2);SetTimer(window,2,180,nullptr);return 0;}
   if(HIWORD(w)==CBN_SELCHANGE){if(LOWORD(w)==211)choose(projectFilter,projectOptions,filter.project);if(LOWORD(w)==212)choose(phaseFilter,phaseOptions,filter.phase);if(LOWORD(w)==213)choose(typeFilter,typeOptions,filter.type);if(LOWORD(w)==214)choose(statusFilter,statusOptions,filter.status);return 0;}
   if(LOWORD(w)==215){filter={};selectedKey.clear();building=true;SetWindowTextW(search,L"");building=false;rebuild();return 0;}
   if(LOWORD(w)==100)launch(L"catalog");if(LOWORD(w)==101)launch(L"open");if(LOWORD(w)==102)launch(L"document");if(LOWORD(w)==103){propertiesMode=!propertiesMode;layout();SetFocus(propertiesMode?details:list);}return 0;
  case WM_NOTIFY:{auto info=reinterpret_cast<NMHDR*>(l);
   if(info->hwndFrom==tree&&info->code==TVN_ITEMEXPANDEDW&&!building){auto n=reinterpret_cast<NMTREEVIEWW*>(l);auto index=static_cast<size_t>(n->itemNew.lParam);if(index<filters.size()){auto const& f=filters[index];bool collapsed=(n->itemNew.state&TVIS_EXPANDED)==0;if(f.value.empty()){if(collapsed)collapsedRoots.insert(f.kind);else collapsedRoots.erase(f.kind);}else if(f.kind==ViewKind::Project){if(collapsed)collapsedProjects.insert(f.value);else collapsedProjects.erase(f.value);}}}
   if(info->hwndFrom==tree&&info->code==TVN_SELCHANGEDW&&!building){auto n=reinterpret_cast<NMTREEVIEWW*>(l);auto index=static_cast<size_t>(n->itemNew.lParam);if(index<filters.size()){filter.kind=filters[index].kind;filter.value=filters[index].value;filter.scopeProject=filters[index].scopeProject;selectedKey.clear();fill();}}
   if(info->hwndFrom==list&&!building){if(info->code==LVN_ITEMCHANGED)selection();if(info->code==NM_DBLCLK)launch(L"open");if(info->code==LVN_KEYDOWN&&reinterpret_cast<NMLVKEYDOWN*>(l)->wVKey==VK_RETURN)launch(L"open");}return 0;}
  case WM_TIMER:
   if(w==1)launch(L"catalog");
   if(w==2){KillTimer(window,2);wchar_t query[257]{};GetWindowTextW(search,query,257);filter.query=query;fill();}return 0;
  case ResultMessage:{if(!async||w!=async->serial)return 0;std::optional<Reply> reply;{std::lock_guard lock(async->mutex);reply=std::move(async->reply);async->reply.reset();}busy=false;
   if(reply){SetWindowTextW(note,reply->message.c_str());if(action==L"catalog"&&(!catalogLoaded||projects!=reply->projects||scope!=reply->scope)){
    bool changedScope=scope!=reply->scope;scope=reply->scope;catalogLoaded=true;projects=std::move(reply->projects);
    if(changedScope||!reply->ok){filter={};selectedKey.clear();collapsedRoots.clear();collapsedProjects.clear();building=true;SetWindowTextW(search,L"");building=false;}
    rebuild(true);if(!reply->ok)SetWindowTextW(note,reply->message.c_str());
   }else if(action==L"catalog"&&reply->ok)caption();}buttons();return 0;}
  case WM_SETFOCUS:if(browser)browser->OnViewWindowActive(this);SetFocus(IsWindowVisible(list)?list:details);return 0;
  case WM_LBUTTONDOWN:{int x=dip(GET_X_LPARAM(l));if(abs(x-splitLeft-4)<6)drag=1;else if(splitRight&&abs(x-splitRight-4)<6)drag=2;if(drag)SetCapture(window);return 0;}
  case WM_MOUSEMOVE:if(drag){RECT r;GetClientRect(window,&r);int x=dip(GET_X_LPARAM(l)),width=dip(r.right);if(drag==1)left=std::clamp(x,160,std::max(160,width/3));else right=std::clamp(width-x,220,std::max(220,width/3));layout();}return 0;
  case WM_LBUTTONUP:drag=0;if(GetCapture()==window)ReleaseCapture();return 0;
  case WM_DESTROY:for(auto child:{tree,list,details,search,projectFilter,phaseFilter,typeFilter,statusFilter})name(child,nullptr);KillTimer(window,1);KillTimer(window,2);if(async)async->stopped=true;return 0;
  case WM_NCDESTROY:SetWindowLongPtrW(window,GWLP_USERDATA,0);window=nullptr;return 0;
 }return DefWindowProcW(window,msg,w,l);}
public:
 explicit View(IShellFolder* owner):folder(owner){std::swprintf(className,100,L"ArchiOfficeDriveShellView-%p",static_cast<void*>(moduleInstance));folder->AddRef();objectCount++;}~View(){DestroyViewWindow();folder->Release();objectCount--;}
 HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(id==IID_IUnknown||id==IID_IOleWindow||id==IID_IShellView)*out=static_cast<IShellView*>(this);else if(id==IID_IFolderView)*out=static_cast<IFolderView*>(this);else return E_NOINTERFACE;AddRef();return S_OK;}
 ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}ULONG STDMETHODCALLTYPE Release()override{auto n=--refs;if(!n)delete this;return n;}
 HRESULT STDMETHODCALLTYPE GetWindow(HWND* out)override{if(!out)return E_POINTER;*out=window;return S_OK;}
 HRESULT STDMETHODCALLTYPE ContextSensitiveHelp(BOOL)override{return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE TranslateAccelerator(MSG* msg)override{if(!msg)return E_POINTER;if(msg->message==WM_KEYDOWN&&msg->wParam=='F'&&GetKeyState(VK_CONTROL)<0){SetFocus(search);SendMessageW(search,EM_SETSEL,0,-1);return S_OK;}if(msg->message==WM_KEYDOWN&&msg->wParam==VK_F5){launch(L"catalog");return S_OK;}return window&&IsDialogMessageW(window,msg)?S_OK:S_FALSE;}
 HRESULT STDMETHODCALLTYPE EnableModeless(BOOL)override{return S_OK;}
 HRESULT STDMETHODCALLTYPE UIActivate(UINT state)override{if(state!=SVUIA_DEACTIVATE&&browser)browser->OnViewWindowActive(this);return S_OK;}
 HRESULT STDMETHODCALLTYPE Refresh()override{launch(L"catalog");return S_OK;}
 HRESULT STDMETHODCALLTYPE CreateViewWindow(IShellView*,LPCFOLDERSETTINGS,IShellBrowser* host,RECT* rect,HWND* out)override{if(!host||!rect||!out)return E_POINTER;*out=nullptr;if(window)return E_UNEXPECTED;HWND parent;auto hr=host->GetWindow(&parent);if(FAILED(hr))return hr;browser=host;browser->AddRef();WNDCLASSW cls{};cls.lpfnWndProc=procedure;cls.hInstance=moduleInstance;cls.hCursor=LoadCursorW(nullptr,IDC_ARROW);cls.hbrBackground=reinterpret_cast<HBRUSH>(COLOR_WINDOW+1);cls.lpszClassName=className;if(!RegisterClassW(&cls)&&GetLastError()!=ERROR_CLASS_ALREADY_EXISTS){auto error=HRESULT_FROM_WIN32(GetLastError());DestroyViewWindow();return error;}
  *out=CreateWindowExW(WS_EX_CONTROLPARENT,className,L"ArchiOffice Drive",WS_CHILD|WS_VISIBLE|WS_CLIPCHILDREN,rect->left,rect->top,rect->right-rect->left,rect->bottom-rect->top,parent,nullptr,moduleInstance,this);if(!*out){auto error=HRESULT_FROM_WIN32(GetLastError());DestroyViewWindow();return error;}return S_OK;}
 HRESULT STDMETHODCALLTYPE DestroyViewWindow()override{if(window)DestroyWindow(window);UnregisterClassW(className,moduleInstance);
  busy=false;catalogLoaded=false;projects.clear();visible.clear();filters.clear();filter={};selectedKey.clear();scope.clear();async.reset();
  tree=list=details=heading=note=refresh=open=document=properties=search=projectFilter=phaseFilter=typeFilter=statusFilter=reset=nullptr;if(font){DeleteObject(font);font=nullptr;}if(titleFont){DeleteObject(titleFont);titleFont=nullptr;}if(browser){browser->Release();browser=nullptr;}return S_OK;}
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
