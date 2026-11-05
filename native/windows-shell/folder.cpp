#include "shell.hpp"
#include <strsafe.h>
#include <shlwapi.h>
class EmptyEnumerator final:public IEnumIDList {
 std::atomic<ULONG> refs{1};
public:
 EmptyEnumerator(){objectCount++;}~EmptyEnumerator(){objectCount--;}
 HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(id==IID_IUnknown||id==IID_IEnumIDList){*out=static_cast<IEnumIDList*>(this);AddRef();return S_OK;}return E_NOINTERFACE;}
 ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}ULONG STDMETHODCALLTYPE Release()override{auto n=--refs;if(!n)delete this;return n;}
 HRESULT STDMETHODCALLTYPE Next(ULONG,PITEMID_CHILD*,ULONG* fetched)override{if(fetched)*fetched=0;return S_FALSE;}
 HRESULT STDMETHODCALLTYPE Skip(ULONG)override{return S_FALSE;}HRESULT STDMETHODCALLTYPE Reset()override{return S_OK;}
 HRESULT STDMETHODCALLTYPE Clone(IEnumIDList** out)override{if(!out)return E_POINTER;*out=new(std::nothrow)EmptyEnumerator();return *out?S_OK:E_OUTOFMEMORY;}
};
class Folder final:public IShellFolder,public IPersistFolder2,public IExplorerPaneVisibility {
 std::atomic<ULONG> refs{1};PIDLIST_ABSOLUTE location=nullptr;
public:
 Folder(){objectCount++;}~Folder(){CoTaskMemFree(location);objectCount--;}
 HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(id==IID_IUnknown||id==IID_IShellFolder)*out=static_cast<IShellFolder*>(this);else if(id==IID_IPersist||id==IID_IPersistFolder||id==IID_IPersistFolder2)*out=static_cast<IPersistFolder2*>(this);else if(id==IID_IExplorerPaneVisibility)*out=static_cast<IExplorerPaneVisibility*>(this);else return E_NOINTERFACE;AddRef();return S_OK;}
 ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}ULONG STDMETHODCALLTYPE Release()override{auto n=--refs;if(!n)delete this;return n;}
 HRESULT STDMETHODCALLTYPE GetClassID(CLSID* id)override{if(!id)return E_POINTER;*id=ShellClsid;return S_OK;}
 HRESULT STDMETHODCALLTYPE Initialize(PCIDLIST_ABSOLUTE id)override{if(!id)return E_INVALIDARG;auto copy=ILCloneFull(id);if(!copy)return E_OUTOFMEMORY;CoTaskMemFree(location);location=copy;return S_OK;}
 HRESULT STDMETHODCALLTYPE GetCurFolder(PIDLIST_ABSOLUTE* id)override{if(!id)return E_POINTER;*id=location?ILCloneFull(location):nullptr;return *id?S_OK:E_FAIL;}
 HRESULT STDMETHODCALLTYPE ParseDisplayName(HWND,IBindCtx*,LPWSTR,ULONG*,PIDLIST_RELATIVE* out,ULONG*)override{if(out)*out=nullptr;return E_INVALIDARG;}
 HRESULT STDMETHODCALLTYPE EnumObjects(HWND,SHCONTF,IEnumIDList** out)override{if(!out)return E_POINTER;*out=new(std::nothrow)EmptyEnumerator();return *out?S_OK:E_OUTOFMEMORY;}
 HRESULT STDMETHODCALLTYPE BindToObject(PCUIDLIST_RELATIVE,IBindCtx*,REFIID,void** out)override{if(out)*out=nullptr;return E_NOINTERFACE;}
 HRESULT STDMETHODCALLTYPE BindToStorage(PCUIDLIST_RELATIVE,IBindCtx*,REFIID,void** out)override{if(out)*out=nullptr;return E_NOINTERFACE;}
 HRESULT STDMETHODCALLTYPE CompareIDs(LPARAM,PCUIDLIST_RELATIVE,PCUIDLIST_RELATIVE)override{return S_OK;}
 HRESULT STDMETHODCALLTYPE CreateViewObject(HWND,REFIID iid,void** out)override{return createView(this,iid,out);}
 HRESULT STDMETHODCALLTYPE GetAttributesOf(UINT count,PCUITEMID_CHILD_ARRAY,SFGAOF* attrs)override{if(!attrs)return E_POINTER;if(count)return E_INVALIDARG;*attrs&=SFGAO_FOLDER|SFGAO_BROWSABLE;return S_OK;}
 HRESULT STDMETHODCALLTYPE GetUIObjectOf(HWND,UINT,PCUITEMID_CHILD_ARRAY,REFIID,UINT*,void** out)override{if(out)*out=nullptr;return E_NOINTERFACE;}
 HRESULT STDMETHODCALLTYPE GetDisplayNameOf(PCUITEMID_CHILD,SHGDNF,STRRET* out)override{if(!out)return E_POINTER;out->uType=STRRET_WSTR;return SHStrDupW(L"ArchiOffice Drive",&out->pOleStr);}
 HRESULT STDMETHODCALLTYPE SetNameOf(HWND,PCUITEMID_CHILD,LPCWSTR,SHGDNF,PITEMID_CHILD* out)override{if(out)*out=nullptr;return E_ACCESSDENIED;}
 HRESULT STDMETHODCALLTYPE GetPaneState(REFEXPLORERPANE pane,EXPLORERPANESTATE* state)override{if(!state)return E_POINTER;*state=pane==EP_NavPane?static_cast<EXPLORERPANESTATE>(EPS_DEFAULT_OFF|EPS_FORCE):EPS_DONTCARE;return S_OK;}
};
HRESULT createFolder(REFIID iid,void** out){if(!out)return E_POINTER;auto folder=new(std::nothrow)Folder();if(!folder){*out=nullptr;return E_OUTOFMEMORY;}auto hr=folder->QueryInterface(iid,out);folder->Release();return hr;}
