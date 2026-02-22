# phits-preprocessor README
PHITS is wonderfully useful, but kinda annoying to use. This is an effort to make it a little easier

## Features
This tool adds a couple of functionalities useful for creating PHITS input files
1) Implements VSCode highlighting for PHITS .inp files

2) Allows you to use variables with nicer names. 
   want to use a variable? Do the following!
   var my_variable_name = whatever_you_want_here

   Then, click the expand button in the run menu (ctrl/cmd + alt + r). 
   This will replace all your named variables and their instances in the input
   file with the whatever you have associated with them
    -> Wellllll almost. It removes spaces because PHITS doesn't really like 1 + 2.
       It likes 1+2

3) Allows you to run and send to PHIG-3D inside the VSCode environment. Automatic detection of a .inp file
   activates an option to run, expand, expand + run, send to PHIG-3D, and expand and send to PHIG-3D. These
   options can be accessed through (ctrl/cmd + alt + r) or through the Run button on the bottom bar


## Requirements
PHITS! That's about it. See the good people at JAEA:

https://phits.jaea.go.jp/ 


## Known Issues

I'm sure there are a lot! This is brand new.

## Release Notes

### 1.0.0

Initial release of this tool. More to come maybe. We shall see...

**Enjoy!**
