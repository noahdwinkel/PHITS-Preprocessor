# phits-preprocessor README
PHITS is wonderfully useful, but kinda annoying to use. This is an effort to make it a little easier.

## Features
This tool adds a couple of functionalities useful for creating PHITS input files
1) Implements VSCode syntax highlighting for PHITS .inp files

2) Allows you to use variables with names other than c1, c2, etc...
   To define a variable:
   var my_variable_name = whatever_you_want_here
                     or 
   var "my_variable_name" = whatever_you_want_here

   Then, click the expand button in the run menu (ctrl/cmd + alt + r). 
   This will generate a file where all your named variables and their instances are replaced with the values you assigned to them.

   When a variable is named without "quotes", it will be inserted within parenthesies and without spaces.

   When a variable is named with "quotes", it will be placed into the text without quotes or parenthesies.

3) Allows you to run and send to PHIG-3D inside the VSCode environment. The run menu can be accessed through the shorcut (ctrl/cmd + alt + r) or through the Run button on the bottom bar. 


## Requirements
PHITS! That's about it. See the good people at JAEA:

https://phits.jaea.go.jp/ 


## Known Issues

I'm sure there are a lot! This is brand new.

## Release Notes

### 1.0.0

Initial release of this tool.

### 1.0.1

Assortment of bug fixes.
1) Variables defined in quotes now are substituted in exactly as written without quotes

2) Variables defined without quotes are now inserted within parenthesies to allow negation of variables to function.

**Enjoy!**
