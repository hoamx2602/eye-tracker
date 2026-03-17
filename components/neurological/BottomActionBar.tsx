 'use client';
 
 import React from 'react';
 
 export type BottomActionBarProps = {
   children: React.ReactNode;
 };
 
 /** Fixed bottom action bar to keep primary CTA in same spot across screens. */
 export default function BottomActionBar({ children }: BottomActionBarProps) {
   return (
     <div className="fixed inset-x-0 bottom-0 z-[60] border-t border-gray-800/60 bg-gradient-to-t from-gray-950 via-gray-950 to-transparent">
       <div className="p-6 flex justify-center">
         <div className="w-full max-w-3xl flex justify-center">{children}</div>
       </div>
     </div>
   );
 }
 
