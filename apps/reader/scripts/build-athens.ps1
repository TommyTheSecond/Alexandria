$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
# Summed-area filtering removes the engraving's fine hatch noise before sampling.
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
public static class AthensSampler {
    public static string[] Sample(string path, int cols, int rows) {
        using (var image = new Bitmap(path)) {
            int w = image.Width, h = image.Height;
            double[,] sum = new double[h + 1, w + 1];
            for (int y = 0; y < h; y++) {
                double rowSum = 0;
                for (int x = 0; x < w; x++) {
                    Color c = image.GetPixel(x, y);
                    rowSum += .2126*c.R + .7152*c.G + .0722*c.B;
                    sum[y+1,x+1] = sum[y,x+1] + rowSum;
                }
            }
            string alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/";
            string[] output = new string[rows];
            for (int y = 0; y < rows; y++) {
                char[] row = new char[cols];
                for (int x = 0; x < cols; x++) {
                    int cx = (int)((x+.5)*w/cols), cy = (int)((y+.5)*h/rows);
                    int x0 = Math.Max(0,cx-5), x1 = Math.Min(w,cx+6);
                    int y0 = Math.Max(0,cy-5), y1 = Math.Min(h,cy+6);
                    double v = (sum[y1,x1]-sum[y0,x1]-sum[y1,x0]+sum[y0,x0])/((x1-x0)*(y1-y0));
                    // Gentle contrast expansion retains midtones instead of clipping them.
                    v = Math.Max(0,Math.Min(1,(v-38)/175));
                    row[x] = alphabet[(int)Math.Round(v*63)];
                }
                output[y] = new string(row);
            }
            return output;
        }
    }
}
"@
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'reference/school-of-athens.jpg'))
$result = [AthensSampler]::Sample($source, 256, 112)
$target = Join-Path $PSScriptRoot '../src/athens-art.json'
[IO.File]::WriteAllText($target, (ConvertTo-Json -InputObject @($result)), [Text.UTF8Encoding]::new($false))
Write-Output 'Generated a shaded 256x112 School of Athens.'