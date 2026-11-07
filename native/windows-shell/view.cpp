#include <initguid.h>
#include "shell.hpp"
#include "navigation.hpp"
#include "presentation.hpp"
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
struct Async {std::atomic<bool> stopped{false},cancelled{false};std::mutex mutex;std::optional<Reply> reply;HWND window=nullptr;UINT serial=0;};
struct Job {std::shared_ptr<Async> state;std::wstring action,project,key,revision,phase,type;int baseVersion=0;HMODULE module=nullptr;int page=0;UINT message=ResultMessage;};
DWORD WINAPI work(void* value){HMODULE module=nullptr;{
 std::unique_ptr<Job> job(static_cast<Job*>(value));module=job->module;
 try{winrt::init_apartment(winrt::apartment_type::multi_threaded);auto reply=request(job->action,job->project,job->key,job->revision,job->page,&job->state->cancelled,job->phase,job->type,job->baseVersion);{std::lock_guard lock(job->state->mutex);job->state->reply=std::move(reply);}if(!job->state->stopped)PostMessageW(job->state->window,job->message,job->state->serial,0);winrt::uninit_apartment();}catch(...){Reply failed;failed.message=L"Le client Drive est indisponible. Réessayez avec Actualiser.";{std::lock_guard lock(job->state->mutex);job->state->reply=std::move(failed);}if(!job->state->stopped)PostMessageW(job->state->window,job->message,job->state->serial,0);}
 }objectCount--;FreeLibraryAndExitThread(module,0);
}

std::wstring status(std::wstring const& value){if(value==L"approuve")return L"Approuvé";if(value==L"en_cours")return L"En cours";if(value==L"perime")return L"Périmé";return value.empty()?L"—":value;}
}
class View final:public IShellView,public IFolderView {
 std::atomic<ULONG> refs{1};IShellFolder* folder;IShellBrowser* browser=nullptr;
 HWND actionsPane=nullptr;int actionScroll=0;
 HWND actionsLabel=nullptr,phaseEdit=nullptr,typeEdit=nullptr,saveClass=nullptr,offline=nullptr,preserve=nullptr,restart=nullptr,retry=nullptr,recovery=nullptr;int classificationVersion=0;bool actionWritable=false;
 HWND window=nullptr,tree=nullptr,list=nullptr,details=nullptr,heading=nullptr,note=nullptr,refresh=nullptr,open=nullptr,document=nullptr,properties=nullptr,search=nullptr,projectFilter=nullptr,phaseFilter=nullptr,typeFilter=nullptr,statusFilter=nullptr,reset=nullptr,defaults=nullptr,tabs=nullptr,preview=nullptr,history=nullptr,previousPage=nullptr,nextPage=nullptr,pageLabel=nullptr;
 HFONT font=nullptr,titleFont=nullptr;UINT dpi=96;int left=230,right=290,drag=0,splitLeft=230,splitRight=0;bool catalogLoaded=false,busy=false,building=false,propertiesMode=false;std::set<std::wstring> collapsedProjects;std::wstring completion;std::wstring action=L"catalog",focusKey,scope;std::set<std::wstring> selectedKeys;bool selectionInitialized=false;Filter filter;Presentation presentation;std::set<ViewKind> collapsedRoots;wchar_t className[100]{};
 std::vector<std::wstring> projectOptions,phaseOptions,typeOptions,statusOptions;
 std::vector<Project> projects;std::vector<Filter> filters;std::vector<std::pair<int,int>> visible;std::shared_ptr<Async> async,detailAsync;
 bool detailBusy=false;int detailTab=0,previewPage=0,previewPages=0,previewWidth=0,previewHeight=0;
 std::vector<unsigned char> previewPixels;std::wstring detailProject,detailKey,detailRevision,requestedDetail,previewMessage=L"Sélectionnez un document.";
 static constexpr UINT DetailMessage=WM_APP+96;
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
  for(auto child:{tree,list,details,note,refresh,open,document,properties,search,projectFilter,phaseFilter,typeFilter,statusFilter,reset,defaults,tabs,actionsLabel,phaseEdit,typeEdit,saveClass,offline,preserve,restart,retry,recovery,history,previousPage,nextPage,pageLabel})SendMessageW(child,WM_SETFONT,reinterpret_cast<WPARAM>(font),TRUE);
  SendMessageW(heading,WM_SETFONT,reinterpret_cast<WPARAM>(titleFont),TRUE);
  if(previous)DeleteObject(previous);if(previousTitle)DeleteObject(previousTitle);
  applyPresentation();TreeView_SetItemHeight(tree,px(25));
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
  for(auto button:{Button{refresh,110},Button{open,100},Button{document,190},Button{properties,125},Button{defaults,200}}){if(button.window==properties&&detailWidth)continue;if(x+button.width>width-16&&x>16){x=16;y+=36;}place(button.window,x,y,button.width,30);x+=button.width+10;}
  int searchY=y+40;place(search,16,searchY,std::max(80,width-152),28);place(reset,std::max(104,width-126),searchY,110,28);
  int columns=width>=1000?4:2,filterY=searchY+36,cell=(width-32-(columns-1)*8)/columns;
  HWND choices[]={projectFilter,phaseFilter,typeFilter,statusFilter};for(int i=0;i<4;i++)place(choices[i],16+(i%columns)*(cell+8),filterY+(i/columns)*36,cell,210);
  int top=filterY+((4+columns-1)/columns)*36+8,body=std::max(30,height-top-64),center=std::max(100,width-treeWidth-detailWidth-32);
  place(tree,12,top,treeWidth-12,body);
  bool alternate=!detailWidth&&propertiesMode;ShowWindow(list,alternate?SW_HIDE:SW_SHOW);bool pane=detailWidth||alternate;
  int paneX=detailWidth?width-detailWidth+4:treeWidth+10,paneWidth=detailWidth?detailWidth-18:center;
  ShowWindow(tabs,pane?SW_SHOW:SW_HIDE);place(tabs,paneX,top,paneWidth,30);
  ShowWindow(details,pane&&detailTab==0?SW_SHOW:SW_HIDE);ShowWindow(history,pane&&detailTab==2?SW_SHOW:SW_HIDE);
  ShowWindow(preview,pane&&detailTab==1?SW_SHOW:SW_HIDE);
  ShowWindow(actionsPane,pane&&detailTab==3?SW_SHOW:SW_HIDE);place(actionsPane,paneX,top+36,paneWidth,std::max(30,body-36));layoutActions();
  for(auto child:{previousPage,nextPage,pageLabel})ShowWindow(child,pane&&detailTab==1?SW_SHOW:SW_HIDE);
  place(list,treeWidth+10,top,center,body);place(details,paneX,top+36,paneWidth,std::max(30,body-36));place(history,paneX,top+36,paneWidth,std::max(30,body-36));
  place(preview,paneX,top+36,paneWidth,std::max(30,body-78));place(previousPage,paneX,top+body-32,72,28);place(nextPage,paneX+paneWidth-72,top+body-32,72,28);place(pageLabel,paneX+76,top+body-30,std::max(1,paneWidth-152),26);
  place(note,16,std::max(110,height-54),std::max(100,width-32),46);InvalidateRect(window,nullptr,TRUE);
 }
 void layoutActions(){if(!actionsPane)return;RECT pane{};GetClientRect(actionsPane,&pane);SCROLLINFO scroll{sizeof(scroll),SIF_RANGE|SIF_PAGE|SIF_POS};scroll.nMax=px(334)-1;scroll.nPage=std::max(1L,pane.bottom);scroll.nPos=actionScroll;SetScrollInfo(actionsPane,SB_VERT,&scroll,TRUE);scroll.fMask=SIF_POS;GetScrollInfo(actionsPane,SB_VERT,&scroll);actionScroll=scroll.nPos;
  auto position=[&](HWND child,int y,int height){MoveWindow(child,0,px(y)-actionScroll,std::max(1L,pane.right),px(height),TRUE);};position(actionsLabel,0,54);position(phaseEdit,56,28);position(typeEdit,92,28);int y=128;for(auto child:{saveClass,offline,preserve,restart,retry,recovery}){position(child,y,28);y+=34;}}
 static LRESULT CALLBACK paneProcedure(HWND pane,UINT msg,WPARAM w,LPARAM l,UINT_PTR,DWORD_PTR reference){auto self=reinterpret_cast<View*>(reference);
  if(msg==WM_VSCROLL||msg==WM_MOUSEWHEEL){SCROLLINFO scroll{sizeof(scroll),SIF_ALL};GetScrollInfo(pane,SB_VERT,&scroll);int pos=scroll.nPos;
   if(msg==WM_MOUSEWHEEL)pos-=GET_WHEEL_DELTA_WPARAM(w)/WHEEL_DELTA*self->px(48);else switch(LOWORD(w)){case SB_LINEUP:pos-=self->px(24);break;case SB_LINEDOWN:pos+=self->px(24);break;case SB_PAGEUP:pos-=scroll.nPage;break;case SB_PAGEDOWN:pos+=scroll.nPage;break;case SB_THUMBTRACK:pos=scroll.nTrackPos;break;case SB_TOP:pos=0;break;case SB_BOTTOM:pos=scroll.nMax;break;}
   self->actionScroll=std::max(0,pos);self->layoutActions();return 0;}
  if(msg==WM_COMMAND){if(HIWORD(w)==BN_SETFOCUS||HIWORD(w)==EN_SETFOCUS){RECT item{},viewport{};GetWindowRect(reinterpret_cast<HWND>(l),&item);MapWindowPoints(nullptr,pane,reinterpret_cast<POINT*>(&item),2);GetClientRect(pane,&viewport);if(item.top<0)self->actionScroll+=item.top;else if(item.bottom>viewport.bottom)self->actionScroll+=item.bottom-viewport.bottom;self->layoutActions();}
   return SendMessageW(self->window,msg,w,l);}
  if(msg==WM_NCDESTROY)RemoveWindowSubclass(pane,paneProcedure,1);return DefSubclassProc(pane,msg,w,l);
 }
 HWND paneFocus(){return detailTab==0?details:detailTab==2?history:tabs;}
 void buttons(){bool valid=!busy&&ListView_GetSelectedCount(list)==1;EnableWindow(refresh,!busy);EnableWindow(open,valid);EnableWindow(document,valid);EnableWindow(offline,valid);EnableWindow(recovery,valid);EnableWindow(saveClass,valid&&!detailBusy&&actionWritable&&classificationVersion>0);EnableWindow(phaseEdit,valid&&actionWritable);EnableWindow(typeEdit,valid&&actionWritable);
  std::wstring state,preservation;if(valid){auto [p,d]=visible[ListView_GetNextItem(list,-1,LVNI_SELECTED)];state=projects[p].rows[d].transferState;preservation=projects[p].rows[d].preservation;}
  EnableWindow(preserve,valid&&state==L"conflict");EnableWindow(restart,valid&&state==L"conflict"&&preservation==L"done");EnableWindow(retry,valid&&(state==L"blocked"||state==L"retry"));}
 void selection(){
  selectedKeys.clear();int selected=-1,first=-1;
  while((selected=ListView_GetNextItem(list,selected,LVNI_SELECTED))>=0)if(selected<static_cast<int>(visible.size())){auto [p,d]=visible[selected];selectedKeys.insert(projects[p].rows[d].key);if(first<0)first=selected;}
  selectionInitialized=true;int focused=ListView_GetNextItem(list,-1,LVNI_FOCUSED);if(focused>=0&&focused<static_cast<int>(visible.size())){auto [p,d]=visible[focused];focusKey=projects[p].rows[d].key;}
  if(first<0){SetWindowTextW(details,L"Sélectionnez un document pour afficher ses propriétés.");updateDetail(L"",L"",L"");buttons();return;}
  if(selectedKeys.size()>1){auto text=std::to_wstring(selectedKeys.size())+L" documents sélectionnés.\r\n\r\nSélectionnez un seul document pour afficher ses propriétés ou l’ouvrir.";SetWindowTextW(details,text.c_str());updateDetail(L"",L"",L"");buttons();return;}
  auto [p,d]=visible[first];auto const& project=projects[p];auto const& doc=project.rows[d];
  auto content=doc.name+L"\r\n\r\nPROPRIÉTÉS\r\n\r\nProjet\r\n"+project.name+L"\r\n\r\nPhase\r\n"+(doc.phase.empty()?L"—":doc.phase)+L"\r\n\r\nType documentaire\r\n"+(doc.type.empty()?L"Non renseigné ou indisponible":doc.type)+L"\r\n\r\nFormat\r\n"+doc.fileType+L"\r\n\r\nIndice métier\r\n"+(doc.indice.empty()?L"—":doc.indice)+L"\r\n\r\nVersion technique du catalogue A:\r\n"+std::to_wstring(doc.version)+L"\r\n\r\nStatut documentaire\r\n"+status(doc.status);
  if(doc.businessKnown){content+=L"\r\n\r\nMétadonnées observées le\r\n"+(doc.metadataDate.empty()?std::wstring(L"Date indisponible"):doc.metadataDate);if(doc.metadataStale)content+=L"\r\nInformations en cache, actualisation en attente.";}
  content+=L"\r\n\r\nDisponibilité locale\r\n"+std::wstring(doc.available==1?L"Contenu entièrement présent":doc.available==0?L"Contenu à télécharger":L"Indisponible");
  content+=L"\r\n\r\nÉtat d’envoi\r\n"+transferLabel(doc.transferState)+L"\r\nLe dernier envoi accepté ne garantit pas l’absence de retouches plus récentes.";
  if(!doc.errorCode.empty()){std::wstring cause=doc.errorCode==L"STORAGE_QUOTA_EXCEEDED"?L"Le stockage de l’agence est plein. Libérez de l’espace ou augmentez le stockage.":doc.errorCode==L"VERSION_CONFLICT"?L"Une autre sauvegarde a créé une version distante.":doc.errorCode==L"LOCKED"?L"Le document est verrouillé par une autre personne.":L"Code : "+doc.errorCode;content+=L"\r\n\r\nCause du blocage\r\n"+cause;}
  if(doc.transferState==L"conflict")content+=L"\r\n\r\nConservation de la copie locale\r\n"+(doc.preservation==L"done"?std::wstring(L"Envoi terminé. La reprise distante est possible."):doc.preservation==L"pending"?std::wstring(L"Envoi de la copie en cours."):doc.preservation==L"blocked"?std::wstring(L"Envoi de la copie bloqué. Vérifiez le stockage et les droits."):std::wstring(L"À demander dans Actions avant toute reprise distante."));
  SetWindowTextW(details,content.c_str());updateDetail(project.id,doc.key,project.revision);buttons();
 }
 std::wstring detailTicket(){return detailKey.empty()?L"":detailProject+L"/"+detailKey+L"/"+detailRevision+L"/"+std::to_wstring(detailTab)+L"/"+std::to_wstring(previewPage);}
 void pageButtons(){EnableWindow(previousPage,!detailBusy&&!detailKey.empty()&&previewPage>0);EnableWindow(nextPage,!detailBusy&&!detailKey.empty()&&previewPages>0&&previewPage+1<previewPages);auto label=previewPages?std::to_wstring(previewPage+1)+L" / "+std::to_wstring(previewPages):L"";SetWindowTextW(pageLabel,label.c_str());}
 void clearPreview(std::wstring message){previewPixels.clear();previewPages=0;previewMessage=std::move(message);SetWindowTextW(preview,previewMessage.c_str());InvalidateRect(preview,nullptr,TRUE);pageButtons();}
 void queueDetail(){KillTimer(window,3);if(detailBusy&&detailAsync)detailAsync->cancelled=true;if(detailKey.empty()||detailTab==0)return;SetTimer(window,3,180,nullptr);}
 void updateDetail(std::wstring project,std::wstring key,std::wstring revision){
  if(project==detailProject&&key==detailKey&&revision==detailRevision)return;
  detailProject=std::move(project);detailKey=std::move(key);detailRevision=std::move(revision);previewPage=0;
  actionWritable=false;classificationVersion=0;SetWindowTextW(phaseEdit,L"");SetWindowTextW(typeEdit,L"");SetWindowTextW(actionsLabel,L"Chargement des droits et du classement…");
  clearPreview(detailKey.empty()?L"Sélectionnez un seul document pour afficher un aperçu.":L"Chargement de l’aperçu…");SetWindowTextW(history,detailKey.empty()?L"Sélectionnez un seul document pour consulter les versions.":L"Chargement de l’historique…");queueDetail();
 }
 void launchDetail(){
  if(detailBusy||detailTab==0||detailKey.empty())return;
  detailAsync=std::make_shared<Async>();detailAsync->window=window;detailAsync->serial=serial++;
  auto job=std::make_unique<Job>();job->state=detailAsync;job->action=detailTab==1?L"preview":detailTab==2?L"versions":L"actions";job->project=detailProject;job->key=detailKey;job->revision=detailRevision;job->page=previewPage;job->message=DetailMessage;
  if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,reinterpret_cast<LPCWSTR>(&work),&job->module))return;
  requestedDetail=detailTicket();detailBusy=true;pageButtons();auto module=job->module;objectCount++;HANDLE thread=CreateThread(nullptr,0,work,job.get(),0,nullptr);
  if(thread){job.release();CloseHandle(thread);}else{objectCount--;FreeLibrary(module);detailBusy=false;clearPreview(L"Aperçu indisponible.");SetWindowTextW(history,L"Historique indisponible.");}
 }
 void fill(bool preserveScroll=false){
  int top=preserveScroll?ListView_GetTopIndex(list):0;bool hadSelection=!selectedKeys.empty();building=true;ListView_DeleteAllItems(list);visible.clear();
  for(int p=0;p<static_cast<int>(projects.size());p++)for(int d=0;d<static_cast<int>(projects[p].rows.size());d++)if(matches(filter,projects[p],projects[p].rows[d]))visible.emplace_back(p,d);
  std::sort(visible.begin(),visible.end(),[&](auto const& a,auto const& b){auto const& left=projects[a.first].rows[a.second];auto const& right=projects[b.first].rows[b.second];int compared=compareDocument(left,right,presentation);if(compared)return compared<0;if(projects[a.first].id!=projects[b.first].id)return projects[a.first].id<projects[b.first].id;return left.key<right.key;});
  int first=-1,focused=-1;
  for(int i=0;i<static_cast<int>(visible.size());i++){auto [p,d]=visible[i];auto const& doc=projects[p].rows[d];LVITEMW item{};item.mask=LVIF_TEXT;item.iItem=i;item.pszText=const_cast<wchar_t*>(doc.name.c_str());ListView_InsertItem(list,&item);
   std::wstring fields[]={doc.phase.empty()?L"—":doc.phase,doc.type.empty()?L"—":doc.type,doc.indice.empty()?L"—":doc.indice,std::to_wstring(doc.version),status(doc.status),transferLabel(doc.transferState)};
   for(int col=0;col<6;col++)ListView_SetItemText(list,i,col+1,fields[col].data());
   if(selectedKeys.contains(doc.key)){ListView_SetItemState(list,i,LVIS_SELECTED,LVIS_SELECTED);if(first<0)first=i;}if(doc.key==focusKey)focused=i;
  }
  if(first<0&&!visible.empty()&&(!selectionInitialized||hadSelection)){first=0;ListView_SetItemState(list,0,LVIS_SELECTED,LVIS_SELECTED);}
  if(focused<0)focused=first;if(focused>=0)ListView_SetItemState(list,focused,LVIS_FOCUSED,LVIS_FOCUSED);
  building=false;selection();if(first>=0&&!preserveScroll)ListView_EnsureVisible(list,first,FALSE);
  if(preserveScroll&&top>0&&!visible.empty()){RECT item{};if(ListView_GetItemRect(list,0,&item,LVIR_BOUNDS))ListView_Scroll(list,0,std::min(top,static_cast<int>(visible.size())-1)*(item.bottom-item.top));}
  sortArrow();caption();
 }
 void sortArrow(){auto header=ListView_GetHeader(list);for(int i=0;i<ColumnCount;i++){HDITEMW item{};item.mask=HDI_FORMAT;if(Header_GetItem(header,i,&item)){item.fmt&=~(HDF_SORTUP|HDF_SORTDOWN);if(i==presentation.sort)item.fmt|=presentation.ascending?HDF_SORTUP:HDF_SORTDOWN;Header_SetItem(header,i,&item);}}}
 void applyPresentation(){for(int i=0;i<ColumnCount;i++)ListView_SetColumnWidth(list,i,px(presentation.widths[i]));ListView_SetColumnOrderArray(list,ColumnCount,presentation.order);sortArrow();}
 void capturePresentation(){if(!window||!IsWindow(list))return;for(int i=0;i<ColumnCount;i++)presentation.widths[i]=std::clamp(dip(ListView_GetColumnWidth(list,i)),45,1200);ListView_GetColumnOrderArray(list,ColumnCount,presentation.order);presentation.left=left;presentation.right=right;savePresentation(scope,presentation);}
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
  if(requested!=L"catalog"){if(ListView_GetSelectedCount(list)!=1)return;int selected=ListView_GetNextItem(list,-1,LVNI_SELECTED);if(selected<0||selected>=static_cast<int>(visible.size()))return;auto [p,d]=visible[selected];job->project=projects[p].id;job->key=projects[p].rows[d].key;job->revision=projects[p].revision;}
  if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,reinterpret_cast<LPCWSTR>(&work),&job->module))return;
  if(requested==L"classify"){wchar_t phase[61]{},type[61]{};GetWindowTextW(phaseEdit,phase,61);GetWindowTextW(typeEdit,type,61);job->phase=phase;job->type=type;job->baseVersion=classificationVersion;}
  if(requested!=L"catalog")completion.clear();busy=true;action=requested;buttons();if(completion.empty())SetWindowTextW(note,requested==L"catalog"?L"Vérification du catalogue Drive…":L"Commande documentaire en cours…");objectCount++;auto module=job->module;HANDLE thread=CreateThread(nullptr,0,work,job.get(),0,nullptr);
  if(thread){job.release();CloseHandle(thread);}else{objectCount--;FreeLibrary(module);busy=false;buttons();}
 }
 LRESULT message(UINT msg,WPARAM w,LPARAM l){switch(msg){
  case WM_CREATE:{INITCOMMONCONTROLSEX init{sizeof(init),ICC_TREEVIEW_CLASSES|ICC_LISTVIEW_CLASSES|ICC_TAB_CLASSES};InitCommonControlsEx(&init);
   heading=control(L"STATIC",L"ArchiOffice Drive",SS_LEFT);refresh=control(L"BUTTON",L"Actualiser",WS_TABSTOP,100);open=control(L"BUTTON",L"Ouvrir",WS_TABSTOP,101);document=control(L"BUTTON",L"Ouvrir dans ArchiOffice",WS_TABSTOP,102);properties=control(L"BUTTON",L"Propriétés",WS_TABSTOP,103);
   defaults=control(L"BUTTON",L"Présentation par défaut",WS_TABSTOP,216);
   search=control(L"EDIT",L"",WS_TABSTOP|ES_AUTOHSCROLL|WS_BORDER,210);SendMessageW(search,EM_SETLIMITTEXT,256,0);SendMessageW(search,EM_SETCUEBANNER,TRUE,reinterpret_cast<LPARAM>(L"Rechercher un document…"));
   reset=control(L"BUTTON",L"Effacer",WS_TABSTOP,215);
   projectFilter=control(L"COMBOBOX",L"",WS_TABSTOP|CBS_DROPDOWNLIST|WS_VSCROLL,211);phaseFilter=control(L"COMBOBOX",L"",WS_TABSTOP|CBS_DROPDOWNLIST|WS_VSCROLL,212);typeFilter=control(L"COMBOBOX",L"",WS_TABSTOP|CBS_DROPDOWNLIST|WS_VSCROLL,213);statusFilter=control(L"COMBOBOX",L"",WS_TABSTOP|CBS_DROPDOWNLIST|WS_VSCROLL,214);
   tree=control(WC_TREEVIEWW,L"",WS_TABSTOP|TVS_HASBUTTONS|TVS_HASLINES|TVS_LINESATROOT|TVS_SHOWSELALWAYS,201);list=control(WC_LISTVIEWW,L"",WS_TABSTOP|LVS_REPORT|LVS_SHOWSELALWAYS,202);ListView_SetExtendedListViewStyle(list,LVS_EX_FULLROWSELECT|LVS_EX_DOUBLEBUFFER|LVS_EX_LABELTIP|LVS_EX_HEADERDRAGDROP);
   wchar_t const* columns[]={L"Document",L"Phase",L"Type",L"Indice",L"Version",L"Statut",L"Synchronisation"};for(int i=0;i<ColumnCount;i++){LVCOLUMNW c{};c.mask=LVCF_TEXT|LVCF_WIDTH;c.pszText=const_cast<wchar_t*>(columns[i]);c.cx=presentation.widths[i];ListView_InsertColumn(list,i,&c);}
   tabs=control(WC_TABCONTROLW,L"",WS_TABSTOP,220);for(auto label:{L"Propriétés",L"Aperçu",L"Versions",L"Actions"}){TCITEMW item{};item.mask=TCIF_TEXT;item.pszText=const_cast<wchar_t*>(label);TabCtrl_InsertItem(tabs,TabCtrl_GetItemCount(tabs),&item);}
   preview=control(L"STATIC",L"Sélectionnez un document.",SS_OWNERDRAW,224);history=control(L"EDIT",L"Sélectionnez un document.",ES_MULTILINE|ES_READONLY|ES_AUTOVSCROLL|WS_VSCROLL|WS_TABSTOP,223);
   previousPage=control(L"BUTTON",L"Précéd.",WS_TABSTOP,221);nextPage=control(L"BUTTON",L"Suivant",WS_TABSTOP,222);pageLabel=control(L"STATIC",L"",SS_CENTER,225);
   actionsPane=control(L"STATIC",L"Actions du document",WS_VSCROLL|WS_CLIPCHILDREN,229);SetWindowLongPtrW(actionsPane,GWL_EXSTYLE,GetWindowLongPtrW(actionsPane,GWL_EXSTYLE)|WS_EX_CONTROLPARENT);SetWindowSubclass(actionsPane,paneProcedure,1,reinterpret_cast<DWORD_PTR>(this));
   actionsLabel=control(L"STATIC",L"Phase puis type documentaire",SS_LEFT);phaseEdit=control(L"EDIT",L"",ES_AUTOHSCROLL|WS_BORDER|WS_TABSTOP,230);typeEdit=control(L"EDIT",L"",ES_AUTOHSCROLL|WS_BORDER|WS_TABSTOP,231);SendMessageW(phaseEdit,EM_SETLIMITTEXT,60,0);SendMessageW(typeEdit,EM_SETLIMITTEXT,60,0);
   saveClass=control(L"BUTTON",L"Enregistrer le classement",WS_TABSTOP,232);offline=control(L"BUTTON",L"Disponible hors ligne",WS_TABSTOP,233);preserve=control(L"BUTTON",L"Conserver la copie locale",WS_TABSTOP,234);restart=control(L"BUTTON",L"Reprendre la version distante",WS_TABSTOP,235);retry=control(L"BUTTON",L"Réessayer l’envoi",WS_TABSTOP,236);recovery=control(L"BUTTON",L"Ouvrir les copies précédentes",WS_TABSTOP,237);for(auto child:{actionsLabel,phaseEdit,typeEdit,saveClass,offline,preserve,restart,retry,recovery})SetParent(child,actionsPane);for(auto child:{saveClass,offline,preserve,restart,retry,recovery})SetWindowLongPtrW(child,GWL_STYLE,GetWindowLongPtrW(child,GWL_STYLE)|BS_NOTIFY);
   name(phaseEdit,L"Phase du document");name(typeEdit,L"Type documentaire");
   details=control(L"EDIT",L"Sélectionnez un document pour afficher ses propriétés.",ES_MULTILINE|ES_READONLY|ES_AUTOVSCROLL|WS_VSCROLL|WS_TABSTOP,203);note=control(L"STATIC",L"",SS_LEFT);scale();name(previousPage,L"Page précédente");name(nextPage,L"Page suivante");name(tabs,L"Propriétés, aperçu, versions et actions");name(preview,L"Aperçu du document");name(history,L"Historique des versions, lecture seule");name(tree,L"Navigation documentaire");name(list,L"Documents du projet");name(details,L"Propriétés du document, lecture seule");name(search,L"Rechercher dans les documents montés");name(projectFilter,L"Filtrer par projet");name(phaseFilter,L"Filtrer par phase");name(typeFilter,L"Filtrer par type documentaire");name(statusFilter,L"Filtrer par statut");SetWindowTheme(tree,L"Explorer",nullptr);SetWindowTheme(list,L"Explorer",nullptr);
   async=std::make_shared<Async>();async->window=window;async->serial=serial++;SetTimer(window,1,5000,nullptr);layout();rebuild();launch(L"catalog");return 0;}
  case WM_SIZE:layout();return 0;
  case WM_DPICHANGED:scale(HIWORD(w));layout();return 0;
  case WM_DPICHANGED_AFTERPARENT:scale();layout();return 0;
  case WM_PAINT:{PAINTSTRUCT paint;HDC dc=BeginPaint(window,&paint);RECT r;GetClientRect(window,&r);auto pen=CreatePen(PS_SOLID,1,GetSysColor(COLOR_3DSHADOW));auto old=SelectObject(dc,pen);for(int divider:{splitLeft,splitRight})if(divider){MoveToEx(dc,px(divider+4),px(88),nullptr);LineTo(dc,px(divider+4),r.bottom-px(42));}SelectObject(dc,old);DeleteObject(pen);EndPaint(window,&paint);return 0;}
  case WM_SETCURSOR:if(LOWORD(l)==HTCLIENT){POINT point;GetCursorPos(&point);ScreenToClient(window,&point);int x=dip(point.x);if(abs(x-splitLeft-4)<6||(splitRight&&abs(x-splitRight-4)<6)){SetCursor(LoadCursorW(nullptr,IDC_SIZEWE));return TRUE;}}break;
  case WM_COMMAND:
   if(LOWORD(w)>=232&&LOWORD(w)<=237){auto commandControl=GetDlgItem(actionsPane,LOWORD(w));if(!IsWindowEnabled(commandControl)||HIWORD(w)!=BN_CLICKED)return 0;
    if(LOWORD(w)==235&&MessageBoxW(window,L"La version distante remplacera la génération de travail du projet. La copie en conflit est conservée dans ArchiOffice et l’ancien dossier reste accessible dans les copies précédentes. Fermez les fichiers du projet avant de continuer.",L"Reprendre la version distante",MB_OKCANCEL|MB_ICONQUESTION)!=IDOK)return 0;
    std::wstring commands[]={L"classify",L"offline",L"preserve",L"restart",L"retry",L"recovery"};launch(commands[LOWORD(w)-232]);return 0;}
   if(building)return 0;
   if(LOWORD(w)==210&&HIWORD(w)==EN_CHANGE){KillTimer(window,2);SetTimer(window,2,180,nullptr);return 0;}
   if(HIWORD(w)==CBN_SELCHANGE){if(LOWORD(w)==211)choose(projectFilter,projectOptions,filter.project);if(LOWORD(w)==212)choose(phaseFilter,phaseOptions,filter.phase);if(LOWORD(w)==213)choose(typeFilter,typeOptions,filter.type);if(LOWORD(w)==214)choose(statusFilter,statusOptions,filter.status);return 0;}
   if(LOWORD(w)==216){presentation=Presentation{};left=presentation.left;right=presentation.right;applyPresentation();layout();fill(true);savePresentation(scope,presentation);return 0;}
   if(LOWORD(w)==215){filter={};selectedKeys.clear();focusKey.clear();selectionInitialized=false;building=true;SetWindowTextW(search,L"");building=false;rebuild();return 0;}
   if(LOWORD(w)==221&&previewPage>0){--previewPage;clearPreview(L"Chargement de la page…");queueDetail();return 0;}
   if(LOWORD(w)==222&&previewPages&&previewPage+1<previewPages){++previewPage;clearPreview(L"Chargement de la page…");queueDetail();return 0;}
   if(LOWORD(w)==100){launch(L"catalog");queueDetail();}if(LOWORD(w)==101)launch(L"open");if(LOWORD(w)==102)launch(L"document");if(LOWORD(w)==103){propertiesMode=!propertiesMode;layout();SetFocus(propertiesMode?paneFocus():list);}return 0;
  case WM_DRAWITEM:{auto item=reinterpret_cast<DRAWITEMSTRUCT*>(l);if(item->CtlID!=224)break;FillRect(item->hDC,&item->rcItem,GetSysColorBrush(COLOR_WINDOW));
   if(previewPixels.empty()){auto rectangle=item->rcItem;InflateRect(&rectangle,-8,-8);SetBkMode(item->hDC,TRANSPARENT);SetTextColor(item->hDC,GetSysColor(COLOR_WINDOWTEXT));DrawTextW(item->hDC,previewMessage.c_str(),-1,&rectangle,DT_WORDBREAK|DT_NOPREFIX);}
   else{int width=item->rcItem.right,height=item->rcItem.bottom;double ratio=std::min(static_cast<double>(width)/previewWidth,static_cast<double>(height)/previewHeight);int w=std::max(1,static_cast<int>(previewWidth*ratio)),h=std::max(1,static_cast<int>(previewHeight*ratio));BITMAPINFO info{};info.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);info.bmiHeader.biWidth=previewWidth;info.bmiHeader.biHeight=-previewHeight;info.bmiHeader.biPlanes=1;info.bmiHeader.biBitCount=32;info.bmiHeader.biCompression=BI_RGB;SetStretchBltMode(item->hDC,HALFTONE);StretchDIBits(item->hDC,(width-w)/2,(height-h)/2,w,h,0,0,previewWidth,previewHeight,previewPixels.data(),&info,DIB_RGB_COLORS,SRCCOPY);}return TRUE;}
  case DetailMessage:{if(!detailAsync||w!=detailAsync->serial)return 0;detailBusy=false;std::optional<Reply> reply;{std::lock_guard lock(detailAsync->mutex);reply=std::move(detailAsync->reply);detailAsync->reply.reset();}
   if(requestedDetail!=detailTicket()||detailAsync->cancelled){queueDetail();pageButtons();return 0;}
   if(reply&&reply->ok){if(detailTab==1){previewWidth=reply->width;previewHeight=reply->height;previewPages=reply->pages;previewPage=reply->page;previewPixels=std::move(reply->pixels);previewMessage=L"Aperçu de la page "+std::to_wstring(previewPage+1);SetWindowTextW(preview,previewMessage.c_str());InvalidateRect(preview,nullptr,TRUE);}else if(detailTab==2)SetWindowTextW(history,reply->history.c_str());else if(detailTab==3){classificationVersion=reply->version;actionWritable=reply->writable;SetWindowTextW(phaseEdit,reply->phase.c_str());SetWindowTextW(typeEdit,reply->docType.c_str());SetWindowTextW(actionsLabel,reply->writable?L"Phase (champ 1), type documentaire (champ 2). Un champ vide retire ce classement.":L"Classement en lecture seule. Le serveur applique les droits, statuts et verrous.");}}
   else{auto message=reply?reply->message:L"Document indisponible.";if(detailTab==1)clearPreview(message);else if(detailTab==3){actionWritable=false;SetWindowTextW(actionsLabel,message.c_str());}else SetWindowTextW(history,message.c_str());}pageButtons();buttons();return 0;}
  case PresentationMessage:capturePresentation();return 0;
  case WM_NOTIFY:{auto info=reinterpret_cast<NMHDR*>(l);
   if(info->hwndFrom==tabs&&info->code==TCN_SELCHANGE){detailTab=TabCtrl_GetCurSel(tabs);queueDetail();layout();return 0;}
   if((info->hwndFrom==ListView_GetHeader(list)||info->hwndFrom==list)&&(info->code==HDN_ENDTRACKW||info->code==HDN_ENDDRAG))PostMessageW(window,PresentationMessage,0,0);
   if(info->hwndFrom==list&&info->code==LVN_COLUMNCLICK&&!building){auto column=reinterpret_cast<NMLISTVIEW*>(l)->iSubItem;if(column>=0&&column<ColumnCount){if(presentation.sort==column)presentation.ascending=!presentation.ascending;else{presentation.sort=column;presentation.ascending=1;}fill(true);savePresentation(scope,presentation);}return 0;}
   if(info->hwndFrom==tree&&info->code==TVN_ITEMEXPANDEDW&&!building){auto n=reinterpret_cast<NMTREEVIEWW*>(l);auto index=static_cast<size_t>(n->itemNew.lParam);if(index<filters.size()){auto const& f=filters[index];bool collapsed=(n->itemNew.state&TVIS_EXPANDED)==0;if(f.value.empty()){if(collapsed)collapsedRoots.insert(f.kind);else collapsedRoots.erase(f.kind);}else if(f.kind==ViewKind::Project){if(collapsed)collapsedProjects.insert(f.value);else collapsedProjects.erase(f.value);}}}
   if(info->hwndFrom==tree&&info->code==TVN_SELCHANGEDW&&!building){auto n=reinterpret_cast<NMTREEVIEWW*>(l);auto index=static_cast<size_t>(n->itemNew.lParam);if(index<filters.size()){filter.kind=filters[index].kind;filter.value=filters[index].value;filter.scopeProject=filters[index].scopeProject;selectedKeys.clear();focusKey.clear();selectionInitialized=false;fill();}}
   if(info->hwndFrom==list&&!building){if(info->code==LVN_ITEMCHANGED)selection();if(info->code==NM_DBLCLK)launch(L"open");if(info->code==LVN_KEYDOWN&&reinterpret_cast<NMLVKEYDOWN*>(l)->wVKey==VK_RETURN)launch(L"open");}return 0;}
  case WM_TIMER:
   if(w==1)launch(L"catalog");if(w==3){KillTimer(window,3);launchDetail();return 0;}
   if(w==2){KillTimer(window,2);wchar_t query[257]{};GetWindowTextW(search,query,257);filter.query=query;fill();}return 0;
  case ResultMessage:{if(!async||w!=async->serial)return 0;std::optional<Reply> reply;{std::lock_guard lock(async->mutex);reply=std::move(async->reply);async->reply.reset();}busy=false;
   if(reply){if(action!=L"catalog")completion=reply->message;SetWindowTextW(note,reply->message.c_str());if(action==L"catalog"&&(!catalogLoaded||projects!=reply->projects||scope!=reply->scope)){
    bool changedScope=scope!=reply->scope;scope=reply->scope;if(changedScope){presentation=loadPresentation(scope);left=presentation.left;right=presentation.right;applyPresentation();layout();}catalogLoaded=true;projects=std::move(reply->projects);
    if(changedScope||!reply->ok){filter={};selectedKeys.clear();focusKey.clear();selectionInitialized=false;collapsedRoots.clear();collapsedProjects.clear();building=true;SetWindowTextW(search,L"");building=false;}
    rebuild(true);if(!reply->ok)SetWindowTextW(note,reply->message.c_str());
   }else if(action==L"catalog"&&reply->ok)caption();}if(!completion.empty())SetWindowTextW(note,completion.c_str());bool completed=action!=L"catalog"&&reply&&reply->ok;buttons();if(completed){if(action==L"classify"){actionWritable=false;queueDetail();}launch(L"catalog");}return 0;}
  case WM_SETFOCUS:if(browser)browser->OnViewWindowActive(this);SetFocus(IsWindowVisible(list)?list:paneFocus());return 0;
  case WM_LBUTTONDOWN:{int x=dip(GET_X_LPARAM(l));if(abs(x-splitLeft-4)<6)drag=1;else if(splitRight&&abs(x-splitRight-4)<6)drag=2;if(drag)SetCapture(window);return 0;}
  case WM_MOUSEMOVE:if(drag){RECT r;GetClientRect(window,&r);int x=dip(GET_X_LPARAM(l)),width=dip(r.right);if(drag==1)left=std::clamp(x,160,std::min(800,std::max(160,width/3)));else right=std::clamp(width-x,220,std::min(800,std::max(220,width/3)));layout();}return 0;
  case WM_LBUTTONUP:if(drag)capturePresentation();drag=0;if(GetCapture()==window)ReleaseCapture();return 0;
  case WM_DESTROY:for(auto child:{tree,list,details,search,projectFilter,phaseFilter,typeFilter,statusFilter,tabs,phaseEdit,typeEdit,preview,history,previousPage,nextPage})name(child,nullptr);KillTimer(window,1);KillTimer(window,2);KillTimer(window,3);if(async){async->stopped=true;async->cancelled=true;}if(detailAsync){detailAsync->stopped=true;detailAsync->cancelled=true;}return 0;
  case WM_NCDESTROY:SetWindowLongPtrW(window,GWLP_USERDATA,0);window=nullptr;return 0;
 }return DefWindowProcW(window,msg,w,l);}
public:
 explicit View(IShellFolder* owner):folder(owner){std::swprintf(className,100,L"ArchiOfficeDriveShellView-%p",static_cast<void*>(moduleInstance));folder->AddRef();objectCount++;}~View(){DestroyViewWindow();folder->Release();objectCount--;}
 HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(id==IID_IUnknown||id==IID_IOleWindow||id==IID_IShellView)*out=static_cast<IShellView*>(this);else if(id==IID_IFolderView)*out=static_cast<IFolderView*>(this);else return E_NOINTERFACE;AddRef();return S_OK;}
 ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}ULONG STDMETHODCALLTYPE Release()override{auto n=--refs;if(!n)delete this;return n;}
 HRESULT STDMETHODCALLTYPE GetWindow(HWND* out)override{if(!out)return E_POINTER;*out=window;return S_OK;}
 HRESULT STDMETHODCALLTYPE ContextSensitiveHelp(BOOL)override{return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE TranslateAccelerator(MSG* msg)override{if(!msg)return E_POINTER;if(msg->message==WM_KEYDOWN&&msg->wParam=='A'&&GetKeyState(VK_CONTROL)<0&&GetFocus()==list){building=true;ListView_SetItemState(list,-1,LVIS_SELECTED,LVIS_SELECTED);building=false;selection();return S_OK;}if(msg->message==WM_KEYDOWN&&msg->wParam=='F' &&GetKeyState(VK_CONTROL)<0){SetFocus(search);SendMessageW(search,EM_SETSEL,0,-1);return S_OK;}if(msg->message==WM_KEYDOWN&&msg->wParam==VK_F5){launch(L"catalog");queueDetail();return S_OK;}return window&&IsDialogMessageW(window,msg)?S_OK:S_FALSE;}
 HRESULT STDMETHODCALLTYPE EnableModeless(BOOL)override{return S_OK;}
 HRESULT STDMETHODCALLTYPE UIActivate(UINT state)override{if(state!=SVUIA_DEACTIVATE&&browser)browser->OnViewWindowActive(this);return S_OK;}
 HRESULT STDMETHODCALLTYPE Refresh()override{launch(L"catalog");queueDetail();return S_OK;}
 HRESULT STDMETHODCALLTYPE CreateViewWindow(IShellView*,LPCFOLDERSETTINGS,IShellBrowser* host,RECT* rect,HWND* out)override{if(!host||!rect||!out)return E_POINTER;*out=nullptr;if(window)return E_UNEXPECTED;HWND parent;auto hr=host->GetWindow(&parent);if(FAILED(hr))return hr;browser=host;browser->AddRef();WNDCLASSW cls{};cls.lpfnWndProc=procedure;cls.hInstance=moduleInstance;cls.hCursor=LoadCursorW(nullptr,IDC_ARROW);cls.hbrBackground=reinterpret_cast<HBRUSH>(COLOR_WINDOW+1);cls.lpszClassName=className;if(!RegisterClassW(&cls)&&GetLastError()!=ERROR_CLASS_ALREADY_EXISTS){auto error=HRESULT_FROM_WIN32(GetLastError());DestroyViewWindow();return error;}
  *out=CreateWindowExW(WS_EX_CONTROLPARENT,className,L"ArchiOffice Drive",WS_CHILD|WS_VISIBLE|WS_CLIPCHILDREN,rect->left,rect->top,rect->right-rect->left,rect->bottom-rect->top,parent,nullptr,moduleInstance,this);if(!*out){auto error=HRESULT_FROM_WIN32(GetLastError());DestroyViewWindow();return error;}return S_OK;}
 HRESULT STDMETHODCALLTYPE DestroyViewWindow()override{capturePresentation();if(window)DestroyWindow(window);UnregisterClassW(className,moduleInstance);
  busy=false;catalogLoaded=false;projects.clear();visible.clear();filters.clear();filter={};selectedKeys.clear();focusKey.clear();selectionInitialized=false;scope.clear();async.reset();detailAsync.reset();detailBusy=false;detailTab=0;detailProject.clear();detailKey.clear();detailRevision.clear();requestedDetail.clear();completion.clear();actionWritable=false;classificationVersion=0;actionScroll=0;previewPixels.clear();previewPages=previewPage=0;
  tree=list=details=heading=note=refresh=open=document=properties=search=projectFilter=phaseFilter=typeFilter=statusFilter=reset=defaults=nullptr,tabs=nullptr,preview=nullptr,history=nullptr,previousPage=nullptr,nextPage=nullptr,pageLabel=nullptr;if(font){DeleteObject(font);font=nullptr;}if(titleFont){DeleteObject(titleFont);titleFont=nullptr;}if(browser){browser->Release();browser=nullptr;}return S_OK;}
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
