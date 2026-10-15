$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Text;
public static class HeaderArtSampler {
    static string alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/";
    public static string[] Title() {
        const int cols=252, rows=42, faceRows=31;
        bool[,] mask=new bool[faceRows,cols-12];
        using(var bitmap=new Bitmap(1800,220)) {
            using(var g=Graphics.FromImage(bitmap)) using(var font=new Font("Georgia",150,FontStyle.Bold,GraphicsUnit.Pixel)) {
                g.Clear(Color.Black); g.TextRenderingHint=TextRenderingHint.AntiAliasGridFit;
                g.DrawString("ALEXANDRIA",font,Brushes.White,-5,-10,StringFormat.GenericTypographic);
            }
            int maxX=0,minY=220,maxY=0;
            for(int y=0;y<220;y++) for(int x=0;x<1800;x++) if(bitmap.GetPixel(x,y).R>100) { maxX=Math.Max(maxX,x); minY=Math.Min(minY,y); maxY=Math.Max(maxY,y); }
            for(int y=0;y<faceRows;y++) for(int x=0;x<cols-12;x++) {
                int px=(int)(x*(maxX+1.0)/(cols-12));
                int py=minY+(int)(y*(maxY-minY+1.0)/faceRows);
                mask[y,x]=bitmap.GetPixel(px,py).R>110;
            }
        }
        string[] output=new string[rows];
        for(int y=0;y<rows;y++) {
            char[] row=new char[cols];
            for(int x=0;x<cols;x++) {
                int tone=-1;
                // Extrusion projects to the lower right, with shaded side planes.
                for(int step=11;step>=0;step--) {
                    int sx=x-step, sy=y-(int)Math.Ceiling(step*.72);
                    if(sx>=0&&sx<cols-12&&sy>=0&&sy<faceRows&&mask[sy,sx]) {
                        if(step>0) tone=12+(11-step)*2;
                        else {
                            bool top=sy==0||!mask[sy-1,sx];
                            bool left=sx==0||!mask[sy,sx-1];
                            tone=top?62:left?54:43-(int)(sy*.22);
                        }
                    }
                }
                row[x]=tone<0?'~':alphabet[tone];
            }
            output[y]=new string(row);
        }
        return output;
    }
}

"@
$title=[HeaderArtSampler]::Title()
$data=@{title=@($title)}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot '../src/header-art.json'),(ConvertTo-Json $data -Depth 4),[Text.UTF8Encoding]::new($false))
Write-Output 'Rendered shaded title.'
