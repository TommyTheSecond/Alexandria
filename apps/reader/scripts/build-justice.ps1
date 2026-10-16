$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
public static class JusticeSampler {
 public static string[] Sample(string path, int cols, int rows) {
  using (var image = new Bitmap(path)) {
   string alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/";
   var output = new string[rows];
   for (int y=0; y<rows; y++) {
    var line = new char[cols];
    for (int x=0; x<cols; x++) {
     int x0=x*image.Width/cols, x1=Math.Max(x0+1,(x+1)*image.Width/cols);
     int y0=y*image.Height/rows, y1=Math.Max(y0+1,(y+1)*image.Height/rows);
     double sum=0; int count=0;
     for(int py=y0;py<y1;py++) for(int px=x0;px<x1;px++) {
      var c=image.GetPixel(px,py);
      double gray=.2126*c.R+.7152*c.G+.0722*c.B;
      sum += gray*c.A/255.0 + 255*(1-c.A/255.0); count++;
     }
     double value=sum/count;
     // Leave the white paper empty; use the existing 64-tone ASCII palette for the engraving.
     line[x] = value>248 ? ' ' : alphabet[(int)Math.Round(Math.Max(0,Math.Min(1,(value-40)/195))*63)];
    }
    output[y]=new string(line);
   }
   return output;
  }
 }
}
"@
$source=Join-Path $PSScriptRoot 'reference/lady-justice.png'
$result=[JusticeSampler]::Sample($source,96,120)
[IO.File]::WriteAllText((Join-Path $PSScriptRoot '../src/justice-art.json'),(ConvertTo-Json -InputObject @($result)),[Text.UTF8Encoding]::new($false))
