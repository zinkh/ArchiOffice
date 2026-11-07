// Isolated renderer: opens an immutable private input, emits bounded BGRA pixels.
#include <windows.h>
#include <objidl.h>
#include <propidl.h>
#include <gdiplus.h>
#include <shcore.h>
#include <winrt/Windows.Data.Pdf.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.Streams.h>
#include <filesystem>
#include <iostream>
#include <memory>
#include <cmath>
#include <algorithm>
#include <winrt/Windows.Foundation.h>
#include <io.h>
#include <fcntl.h>
using namespace Gdiplus;
namespace fs=std::filesystem;
int render(wchar_t const* input,unsigned page){
 if(fs::file_size(input)>50ULL*1024*1024)return 2;
 auto extension=fs::path(input).extension().wstring();for(auto& c:extension)c=static_cast<wchar_t>(towlower(c));
 std::unique_ptr<Bitmap> source;winrt::com_ptr<IStream> stream;unsigned pages=1;
 if(extension==L".pdf"){
  auto file=winrt::Windows::Storage::StorageFile::GetFileFromPathAsync(input).get();auto pdf=winrt::Windows::Data::Pdf::PdfDocument::LoadFromFileAsync(file).get();pages=pdf.PageCount();if(!pages||pages>10000||page>=pages)return 2;
  auto selected=pdf.GetPage(page);auto size=selected.Size();if(!(size.Width>0&&size.Height>0&&std::isfinite(size.Width)&&std::isfinite(size.Height)))return 2;
  double ratio=std::min(512.0/size.Width,640.0/size.Height);winrt::Windows::Data::Pdf::PdfPageRenderOptions options;
  options.DestinationWidth(std::max(1U,static_cast<unsigned>(size.Width*ratio)));options.DestinationHeight(std::max(1U,static_cast<unsigned>(size.Height*ratio)));
  winrt::Windows::Storage::Streams::InMemoryRandomAccessStream bytes;selected.RenderToStreamAsync(bytes,options).get();selected.Close();
  if(bytes.Size()>8*1024*1024)return 2;bytes.Seek(0);winrt::check_hresult(CreateStreamOverRandomAccessStream(bytes.as<IUnknown>().get(),IID_PPV_ARGS(stream.put())));
  source.reset(Bitmap::FromStream(stream.get(),FALSE));
 }else{
  if(page)return 2;
  if(extension!=L".png"&&extension!=L".jpg"&&extension!=L".jpeg"&&extension!=L".gif"&&extension!=L".bmp"&&extension!=L".tif"&&extension!=L".tiff")return 2;
  source.reset(Bitmap::FromFile(input,FALSE));
 }
 if(!source||source->GetLastStatus()!=Ok||!source->GetWidth()||!source->GetHeight()||static_cast<ULONGLONG>(source->GetWidth())*source->GetHeight()>64ULL*1024*1024)return 2;
 double ratio=std::min({1.0,512.0/source->GetWidth(),640.0/source->GetHeight()});unsigned width=std::max(1U,static_cast<unsigned>(source->GetWidth()*ratio)),height=std::max(1U,static_cast<unsigned>(source->GetHeight()*ratio));
 Bitmap output(width,height,PixelFormat32bppARGB);{Graphics graphics(&output);graphics.Clear(Color::White);graphics.SetInterpolationMode(InterpolationModeHighQualityBicubic);if(graphics.DrawImage(source.get(),0,0,width,height)!=Ok)return 2;}
 Rect rectangle(0,0,width,height);BitmapData data{};if(output.LockBits(&rectangle,ImageLockModeRead,PixelFormat32bppARGB,&data)!=Ok)return 2;
 _setmode(_fileno(stdout),_O_BINARY);std::cout.write("AOP1",4);for(unsigned value:{width,height,pages,page})std::cout.write(reinterpret_cast<char*>(&value),4);
 for(unsigned y=0;y<height;y++)std::cout.write(static_cast<char*>(data.Scan0)+static_cast<ptrdiff_t>(y)*data.Stride,static_cast<std::streamsize>(width)*4);
 output.UnlockBits(&data);return std::cout.good()?0:2;
}
int wmain(int argc,wchar_t** argv){
 if(argc!=3)return 2;ULONG_PTR token=0;GdiplusStartupInput startup;if(GdiplusStartup(&token,&startup,nullptr)!=Ok)return 2;
 int result=2;try{winrt::init_apartment(winrt::apartment_type::multi_threaded);wchar_t* end=nullptr;auto page=wcstoul(argv[2],&end,10);if(end&&!*end&&page<10000)result=render(argv[1],page);winrt::uninit_apartment();}catch(winrt::hresult_error const& error){std::cerr<<"Preview HRESULT "<<std::hex<<static_cast<unsigned long>(error.code())<<std::endl;}catch(...){}
 GdiplusShutdown(token);return result;
}
