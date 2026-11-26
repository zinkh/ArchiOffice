#pragma once
#include "shell.hpp"
#include <cwctype>
enum class ViewKind { All, Project, Phase, Type, Unclassified, Offline, Conflict };
struct Filter {
 ViewKind kind=ViewKind::All;std::wstring value,project,phase,type,status,query,scopeProject;
};
inline bool containsText(std::wstring const& text,std::wstring const& term) {
 return term.empty()||(!text.empty()&&FindNLSStringEx(LOCALE_NAME_USER_DEFAULT,FIND_FROMSTART|NORM_IGNORECASE|NORM_IGNORENONSPACE,text.c_str(),static_cast<int>(text.size()),term.c_str(),static_cast<int>(term.size()),nullptr,nullptr,nullptr,0)>=0);
}
inline bool matches(Filter const& f,Project const& p,Document const& d) {
 if(f.kind==ViewKind::Project&&!f.value.empty()&&p.id!=f.value)return false;
 if(f.kind==ViewKind::Phase&&!f.value.empty()&&d.phase!=f.value)return false;
 if(f.kind==ViewKind::Type&&!f.value.empty()&&d.type!=f.value)return false;
 if(f.kind==ViewKind::Unclassified&&!d.unclassified)return false;
 if(f.kind==ViewKind::Offline&&d.available!=1)return false;
 if(f.kind==ViewKind::Conflict&&d.transferState!=L"conflict")return false;
 if(!f.scopeProject.empty()&&p.id!=f.scopeProject)return false;
 if(!f.project.empty()&&p.id!=f.project)return false;
 if(!f.phase.empty()&&d.phase!=f.phase)return false;
 if(!f.type.empty()&&d.type!=f.type)return false;
 if(!f.status.empty()&&d.status!=f.status)return false;
 std::wstring haystack=p.name+L" "+d.name+L" "+d.phase+L" "+d.type+L" "+d.fileType+L" "+d.indice+L" "+d.status;
 size_t start=0;
 while(start<f.query.size()) {while(start<f.query.size()&&iswspace(f.query[start]))++start;size_t end=start;while(end<f.query.size()&&!iswspace(f.query[end]))++end;if(end>start&&!containsText(haystack,f.query.substr(start,end-start)))return false;start=end;}
 return true;
}
