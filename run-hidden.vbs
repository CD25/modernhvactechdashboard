' Runs the dashboard in the background (no window) and restarts it if it stops.
' Started by install-windows.bat and by the launcher in the Windows Startup folder.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
If Not fso.FolderExists(dir & "\data") Then fso.CreateFolder(dir & "\data")

' Already running? Then there's nothing to do.
On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.Open "GET", "http://127.0.0.1:8080/healthz", False
http.Send
If Err.Number = 0 And http.Status = 200 Then WScript.Quit
On Error GoTo 0

Do
  sh.Run "cmd /c node server\index.js >> data\server.log 2>&1", 0, True
  WScript.Sleep 10000
Loop
