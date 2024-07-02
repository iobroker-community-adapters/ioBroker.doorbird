# Older changes
## 1.3.0 (2023-10-03)

-   (Schmakus) add debug logs to find out "Maximum call stack size exceeded"
-   (Schmakus) update dependencies

## 1.2.4 (2023-08-31)

-   (Schmakus) tryed to fixed [#73] Maximum call stack size exceeded
-   (Stefan592) fixed 'listen on all interfaces'

## 1.2.3 (2023-08-17)

-   (Schmakus) changed schedule handling. (fix status code 400)

## 1.2.2 (2023-08-17)

-   (Schmakus) some code improvements

## 1.2.1 (2023-08-17)

-   (Schmakus) Issue 'Maximum call stack size exceeded' - try to fix

## 1.2.0 (2023-08-08)

-   (Schmakus) Update package.json (Node.js v16 or higher and NPM v7 or higher is required!)
-   (Stefan592/Schmakus) bugfix 'listen on all interfaces'

## 1.1.1 (2023-08-03)

-   (Schmakus) fixed js-controller dependency [#69]

## 1.1.0 (2023-08-03)

-   (Schmakus/Stefan592) support 'listen on all interfaces' (e.g. for Docker)

## 1.0.6 (2023-08-03)

-   (Schmakus) Hotfix #66 Error in parsing schedules
-   (Schmakus) Update documentation
-   (Schmakus) Update dependencies

## 1.0.5 (2023-07-05)

-   (Schmakus) Fixed AxiosError (deletion of duplicates) [#55]

## 1.0.4 (2023-07-05)

-   (Schmakus) Interim solution because deletion of duplicate favorites

## 1.0.2 (2023-07-04)

-   (Schmakus) Hotfix because dev-mode was active

## 1.0.1 (2023-07-04)

-   (Schmakus) remove unused packages
-   (Schmakus) added migration from older versions to delete unused snapshot states
-   (Schmakus) some code improvements

## 1.0.0 (2023-07-04)

-   (Schmakus) Re-new with adapter creator
-   (Schmakus) Changed snapshot handling! Find snapshot at ioBroker Files now!
-   (Schmakus) Support take snapshot manually has been added
-   (Schmakus) Support for light-On has been added

## 0.2.0 (2023-06-25)

-   (mcm1957) Adapter has been moved into iobroker-community-adapters-area
-   (mcm1957) Github actions and testing has been added
-   (mcm1957) standard development tools have been added
-   (mcm1957) dependencies have been upgraded

## 0.1.7 (2023-05-16)

-   (todde99) Fixed js-controller 5 issue

## 0.1.5 (2018-09-18)

-   (BuZZy1337) Check response of Doorbird when triggering relays
-   (BuZZy1337) Check if any favorite has to be updated (For example when adapter address or port changes)
-   (BuZZy1337) Added state for restarting DoorBird Device (There is a bug in DoorBird Firmware. DoorBird will fix it with next FW Update!)
-   (BuZZy1337) Change some Code for working more with responses from DoorBird

## 0.1.0 (2018-09-08)

-   (BuZZy1337) "public release"
-   (BuZZy1337) Changed Adapter address option from dropdown list to input field
-   (BuZZy1337) Added Support for triggering Doorbird-Relays

## 0.0.4

-   (BuZZy1337) DO A COMPLETE REINSTALL OF THE ADAPTER (DELETE AND INSTALL THE ADAPTER AGAIN!)
    DELETE ALL IOBROKER SCHEDULES AND THEN ALL IOBROKER FAVORITES IN YOUR DOORBIRD APP BEFORE STARTING 0.0.4!
-   (BuZZy1337) Added support for more than one Doorbell Button
-   (BuZZy1337) Encrypted saving of Doorbird Password
-   (BuZZy1337) Detect and create Favorites & Schedules on the Doorbird Device.
-   There is a Bug in the Doorbird Firmware for the Motion schedule! You can delete and set the Schedule for the Motion sensor in the App - that's a workaround for now.

## 0.0.3

-   (BuZZy1337) Added possibility to choose the AdapterIP Address

## 0.0.2

-   (BuZZy1337) Just added the info that the Adapter is not ready yet .. just to be sure! ;)

## 0.0.1

-   (BuZZy1337) initial release
