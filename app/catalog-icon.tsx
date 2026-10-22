import {Package,Sparkles,Star,Heart,Tag,ShieldCheck,Zap,LayoutGrid,ShoppingBag,Coffee,LampDesk,NotebookPen,House,TreePine,GlassWater,Umbrella,Send,Globe,Code2,FileText,Headphones,Apple} from 'lucide-react';
import {customIconText} from '@/lib/commerce/catalog-icons';
const icons:Record<string,any>={box:Package,sparkles:Sparkles,star:Star,heart:Heart,tag:Tag,shield:ShieldCheck,zap:Zap,grid:LayoutGrid,cup:Coffee,bottle:GlassWater,bag:ShoppingBag,lamp:LampDesk,notebook:NotebookPen,desk:LayoutGrid,home:House,outdoor:TreePine,umbrella:Umbrella,send:Send,globe:Globe,code:Code2,file:FileText,headphones:Headphones,apple:Apple};
export default function CatalogIcon({value='',size=20}:{value?:string;size?:number}){
 const text=customIconText(value),Icon=icons[value]||Package;
 return text?<span className="custom-catalog-icon" style={{fontSize:Math.max(12,Math.round(size/(text.length>3?2:1)))}} aria-hidden="true">{text}</span>:<Icon size={size} strokeWidth={1.55} aria-hidden="true"/>;
}
