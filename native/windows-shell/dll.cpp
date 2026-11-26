#include "shell.hpp"
HINSTANCE moduleInstance=nullptr;std::atomic<long> objectCount{0};std::atomic<long> locks{0};
class Factory final:public IClassFactory {
 std::atomic<ULONG> refs{1};
public:
 Factory(){objectCount++;}~Factory(){objectCount--;}
 HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(id==IID_IUnknown||id==IID_IClassFactory){*out=static_cast<IClassFactory*>(this);AddRef();return S_OK;}return E_NOINTERFACE;}
 ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}ULONG STDMETHODCALLTYPE Release()override{auto n=--refs;if(!n)delete this;return n;}
 HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer,REFIID iid,void** out)override{if(outer)return CLASS_E_NOAGGREGATION;return createFolder(iid,out);}
 HRESULT STDMETHODCALLTYPE LockServer(BOOL lock)override{if(lock)locks++;else locks--;return S_OK;}
};
extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID clsid,REFIID iid,void** out){if(!out)return E_POINTER;*out=nullptr;if(clsid!=ShellClsid)return CLASS_E_CLASSNOTAVAILABLE;auto factory=new(std::nothrow)Factory();if(!factory)return E_OUTOFMEMORY;auto hr=factory->QueryInterface(iid,out);factory->Release();return hr;}
extern "C" HRESULT __stdcall DllCanUnloadNow(){return !objectCount&&!locks?S_OK:S_FALSE;}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH){moduleInstance=instance;DisableThreadLibraryCalls(instance);}else if(reason==DLL_PROCESS_DETACH)UnregisterClassW(ViewClass,instance);return TRUE;}
