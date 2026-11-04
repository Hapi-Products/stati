type DeviceNavigator={userAgent?:string;platform?:string;maxTouchPoints?:number;userAgentData?:{mobile?:boolean}};

// This only chooses the sign-in interface. The server still verifies every
// passkey, invitation and account permission independently of the device type.
export function usesMobileCodeScreen(device:DeviceNavigator=typeof navigator==='undefined'?{}:navigator):boolean{
 return device.userAgentData?.mobile===true||/Android|iPhone|iPad|iPod/i.test(device.userAgent||'')||(device.platform==='MacIntel'&&(device.maxTouchPoints||0)>1);
}
