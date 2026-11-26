#pragma once
#include "shell.hpp"
#include <algorithm>
#include <array>
#include <shlwapi.h>
inline constexpr int ColumnCount=7;
inline constexpr UINT PresentationMessage=WM_APP+95;
struct Presentation {
 DWORD schema=1;
 int widths[ColumnCount]={260,85,95,75,80,120,170};
 int order[ColumnCount]={0,1,2,3,4,5,6};
 int sort=0;DWORD ascending=1;int left=230,right=290;
};
inline bool validPresentation(Presentation const& p) {
 if(p.schema!=1||p.sort<0||p.sort>=ColumnCount||p.ascending>1||p.left<160||p.left>800||p.right<220||p.right>800)return false;
 std::array<bool,ColumnCount> seen{};
 for(int i=0;i<ColumnCount;i++){if(p.widths[i]<45||p.widths[i]>1200||p.order[i]<0||p.order[i]>=ColumnCount||seen[p.order[i]])return false;seen[p.order[i]]=true;}
 return true;
}
inline bool validScope(std::wstring const& scope){return scope.size()==64&&scope.find_first_not_of(L"0123456789abcdef")==std::wstring::npos;}
inline std::wstring presentationKey(std::wstring const& scope){return std::wstring(RuntimeKey)+L"\\Presentation\\"+scope;}
inline Presentation loadPresentation(std::wstring const& scope){
 Presentation result;if(!validScope(scope))return result;
 Presentation candidate;DWORD bytes=sizeof(candidate),type=0;
 if(RegGetValueW(HKEY_CURRENT_USER,presentationKey(scope).c_str(),L"Layout",RRF_RT_REG_BINARY,&type,&candidate,&bytes)==ERROR_SUCCESS&&bytes==sizeof(candidate)&&validPresentation(candidate))result=candidate;
 return result;
}
inline void savePresentation(std::wstring const& scope,Presentation const& p){
 if(validScope(scope)&&validPresentation(p))RegSetKeyValueW(HKEY_CURRENT_USER,presentationKey(scope).c_str(),L"Layout",REG_BINARY,&p,sizeof(p));
}
inline std::wstring transferLabel(std::wstring const& value){
 if(value==L"none")return L"Aucun envoi suivi";if(value==L"queued")return L"En attente";if(value==L"uploading")return L"Envoi en cours";if(value==L"retry")return L"Nouvelle tentative prévue";
 if(value==L"blocked")return L"Envoi bloqué";if(value==L"conflict")return L"Conflit";if(value==L"uploaded")return L"Dernier envoi accepté";if(value==L"reconciled")return L"Reprise distante effectuée";return L"Indisponible";
}
inline std::wstring sortText(Document const& d,int column){
 switch(column){case 0:return d.name;case 1:return d.phase;case 2:return d.type;case 3:return d.indice;case 5:return d.status;case 6:return d.transferState.empty()?L"":transferLabel(d.transferState);default:return L"";}
}
inline int compareDocument(Document const& a,Document const& b,Presentation const& p){
 int compared=0;
 if(p.sort==4)compared=a.version<b.version?-1:a.version>b.version?1:0;
 else {auto left=sortText(a,p.sort),right=sortText(b,p.sort);if(left.empty()!=right.empty())return left.empty()?1:-1;compared=StrCmpLogicalW(left.c_str(),right.c_str());}
 if(compared)return p.ascending?compared:-compared;
 return StrCmpLogicalW(a.name.c_str(),b.name.c_str());
}
