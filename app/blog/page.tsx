import type { Metadata } from 'next';
import Link from 'next/link';
import { whisperingSignature } from '../../src/lib/fonts';
import { getBlogPosts } from '../../src/lib/blog-storage';

export const metadata: Metadata = {
  title: 'Design Blog',
  description: 'Guides on fashion design, vector editing, AR try-ons, and browser-based creative workflows.',
  alternates: {
    canonical: '/blog',
  },
};

export default async function BlogPage() {
  const posts = await getBlogPosts();

  return (
    <main className="min-h-screen bg-[#ece8e3] px-4 py-6 text-slate-900 md:px-8 lg:px-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-[1120px] flex-col overflow-hidden bg-[#fffdfa] shadow-[0_28px_80px_rgba(15,23,42,0.12)]">
        <section className="border-b border-[#ece5db] bg-[#fffdfa] px-5 py-12 md:px-8 md:py-14">
          <div className="mx-auto max-w-5xl">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#ece5db] pb-5">
              <div className="flex min-w-0 items-center gap-3">
                <img src="/logo.png" alt="DesignIt" className="h-8 w-auto" />
                <div>
                  <span className="block truncate text-lg font-black tracking-tight text-slate-900 sm:text-xl">
                    Design<span className="text-[#9b5a2e]">It</span>
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Browser Design Studio</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-6 text-[11px] font-medium text-slate-600">
                <Link href="/" className="transition-colors hover:text-slate-900">Home</Link>
                <Link href="/blog" className="text-slate-900">Blog</Link>
                <Link href="/community" className="transition-colors hover:text-slate-900">Community</Link>
                <Link href="/about" className="transition-colors hover:text-slate-900">About</Link>
                <Link href="/contact" className="transition-colors hover:text-slate-900">Contact</Link>
                <Link href="/studio" className="bg-black px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-white transition-colors hover:bg-slate-800">
                  Make a Design
                </Link>
              </div>
            </div>
            <p className="mt-10 text-[11px] font-black uppercase tracking-[0.22em] text-[#7c4a26]">Editorial Space</p>
            <h1 className={`${whisperingSignature.className} mt-4 max-w-4xl text-5xl tracking-tight text-slate-900 sm:text-6xl`}>Fashion Design, AR Try-On & Vector Editing Guides</h1>
            <p className="mt-5 max-w-4xl text-base leading-8 text-slate-600">Welcome to the iDesignIts editorial space-a practical resource for anyone exploring fashion, jewelry, digital design, and online shopping.</p>
            <p className="mt-4 max-w-4xl text-base leading-8 text-slate-600">Whether you are an online shopper trying to visualize a piece before buying, a designer developing a new idea, or a creative experimenting with digital artwork, our guides are designed to make the process easier to understand and more accessible.</p>
            <div className="mt-8 flex flex-wrap gap-3 text-sm font-bold">
              <Link href="/studio" className="bg-black px-5 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-white transition-colors hover:bg-slate-800">Open Design Studio</Link>
              <Link href="/about" className="border border-slate-200 bg-white px-5 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-slate-700 transition-colors hover:bg-slate-50">About DesignIt</Link>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-14 text-slate-700 md:px-8">
        <div className="space-y-12">
          <section>
            <h2 className={`${whisperingSignature.className} text-4xl tracking-tight text-slate-900`}>Fashion Design Guides</h2>
            <p className="mt-4 text-base leading-8">Fashion design begins with an idea, but turning that idea into something visual can be challenging. Our fashion design guides explore the creative process from inspiration and shape development to colors, materials, patterns, and digital presentation.</p>
            <p className="mt-4 text-base font-bold text-slate-900">Learn how to:</p>
            <ul className="mt-4 list-disc space-y-2 pl-6 text-base leading-8">
              <li>Develop and refine fashion and jewelry concepts</li>
              <li>Explore color combinations and design variations</li>
              <li>Create digital versions of design ideas</li>
              <li>Understand basic principles of shape, proportion, and composition</li>
              <li>Prepare designs for digital presentation</li>
              <li>Experiment with different styles before committing to a final concept</li>
            </ul>
            <p className="mt-4 text-base leading-8">Our goal is to make digital fashion design approachable for both beginners and experienced creators.</p>
          </section>

          <section>
            <h2 className={`${whisperingSignature.className} text-4xl tracking-tight text-slate-900`}>AR Try-On Guides</h2>
            <p className="mt-4 text-base leading-8">Shopping online can make it difficult to know how a fashion or jewelry item will look when worn. Augmented reality can help bridge that gap by allowing shoppers to preview designs in a more interactive way.</p>
            <p className="mt-4 text-base leading-8">Our AR try-on guides explain how virtual try-on technology works and how shoppers and designers can use it as part of the design and shopping experience.</p>
            <p className="mt-4 text-base font-bold text-slate-900">Explore topics such as:</p>
            <ul className="mt-4 list-disc space-y-2 pl-6 text-base leading-8">
              <li>How virtual try-on works</li>
              <li>How AR can help shoppers visualize jewelry and accessories</li>
              <li>What makes a good virtual try-on experience</li>
              <li>How to evaluate a design before purchasing</li>
              <li>Using virtual visualization during the design process</li>
              <li>The role of AR in the future of online fashion shopping</li>
            </ul>
            <p className="mt-4 text-base leading-8">AR isn't intended to replace the real-world experience of fashion-it adds another way to explore a design before making a decision.</p>
          </section>

          <section>
            <h2 className={`${whisperingSignature.className} text-4xl tracking-tight text-slate-900`}>Vector Editing Guides</h2>
            <p className="mt-4 text-base leading-8">Vector graphics are an important part of modern digital design because they allow artwork and shapes to be resized while maintaining clean edges.</p>
            <p className="mt-4 text-base leading-8">Our vector editing guides help designers understand the fundamentals of working with vector artwork and digital shapes.</p>
            <p className="mt-4 text-base font-bold text-slate-900">Learn about:</p>
            <ul className="mt-4 list-disc space-y-2 pl-6 text-base leading-8">
              <li>What vector graphics are</li>
              <li>The difference between raster and vector images</li>
              <li>Converting images into editable vector artwork</li>
              <li>Editing shapes and paths</li>
              <li>Working with colors and fills</li>
              <li>Resizing designs without losing clarity</li>
              <li>Preparing vector artwork for digital design projects</li>
            </ul>
            <p className="mt-4 text-base leading-8">These guides are written for designers who want practical explanations without unnecessary technical complexity.</p>
          </section>

          <section>
            <h2 className={`${whisperingSignature.className} text-4xl tracking-tight text-slate-900`}>Guides for Online Shoppers</h2>
            <p className="mt-4 text-base leading-8">Digital tools are changing the way people discover and shop for fashion and jewelry online.</p>
            <p className="mt-4 text-base leading-8">Before purchasing a design, shoppers may want to understand its appearance, style, color, proportions, and how it might look when worn. Digital visualization tools can make that process more interactive.</p>
            <p className="mt-4 text-base font-bold text-slate-900">Our shopping guides cover topics such as:</p>
            <ul className="mt-4 list-disc space-y-2 pl-6 text-base leading-8">
              <li>How to evaluate fashion and jewelry designs online</li>
              <li>Using virtual try-on before making a purchase</li>
              <li>Understanding digital representations of products</li>
              <li>Comparing styles and design variations</li>
              <li>Making more informed online design choices</li>
              <li>Understanding how digital fashion technology is changing shopping</li>
            </ul>
            <p className="mt-4 text-base leading-8">The objective is simple: give shoppers more information and more ways to explore a product before deciding.</p>
          </section>

          <section>
            <h2 className={`${whisperingSignature.className} text-4xl tracking-tight text-slate-900`}>Guides for Designers</h2>
            <p className="mt-4 text-base leading-8">Digital design tools can help transform an initial concept into something that can be explored, modified, and presented digitally.</p>
            <p className="mt-4 text-base leading-8">iDesignIts guides are also created for designers who want to experiment with new workflows involving fashion design, vector artwork, and virtual visualization.</p>
            <p className="mt-4 text-base font-bold text-slate-900">Topics include:</p>
            <ul className="mt-4 list-disc space-y-2 pl-6 text-base leading-8">
              <li>Digital concept development</li>
              <li>Creating editable design elements</li>
              <li>Experimenting with shape and color</li>
              <li>Preparing artwork for online presentation</li>
              <li>Using virtual try-on as part of the design process</li>
              <li>Designing with the online customer experience in mind</li>
            </ul>
            <p className="mt-4 text-base leading-8">Whether you're developing a personal project or exploring a commercial design concept, digital tools can make experimentation faster and more flexible.</p>
          </section>

          <section>
            <h2 className={`${whisperingSignature.className} text-4xl tracking-tight text-slate-900`}>The Future of Digital Fashion</h2>
            <p className="mt-4 text-base leading-8">Fashion is becoming increasingly digital. Designers can create and modify concepts on screen, shoppers can interact with products before purchasing, and technologies such as augmented reality are creating new ways to experience fashion online.</p>
            <p className="mt-4 text-base leading-8">At iDesignIts, we explore this intersection of <strong>fashion, design, technology, and online shopping</strong>.</p>
            <p className="mt-4 text-base leading-8">Our editorial guides are intended to help people understand these technologies while discovering practical ways to use them.</p>
            <p className="mt-4 text-base leading-8">From the first design idea to digital editing and virtual visualization, the creative process is becoming more interactive-and we're excited to explore where it goes next.</p>
            <p className={`${whisperingSignature.className} mt-6 text-3xl tracking-tight text-slate-900`}>Explore. Design. Visualize.</p>
            <p className="mt-3 text-base leading-8"><strong>iDesignIts brings fashion design, digital editing, and virtual try-on together to help shoppers and designers explore ideas in a more interactive way.</strong></p>
          </section>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-14 md:px-8">
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {posts.map((post) => (
            <article key={post.id} className="border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#7c4a26]">{post.category}</p>
              <h2 className={`${whisperingSignature.className} mt-3 text-3xl leading-tight text-slate-900`}>{post.title}</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">{post.excerpt}</p>
              <div className="mt-5 flex items-center justify-between text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                <span>{post.readTime}</span>
                <span>{new Date(post.publishedAt).toLocaleDateString()}</span>
              </div>
              <Link href={`/blog/${post.slug}`} className="mt-6 inline-flex text-sm font-black text-[#7d47b5] transition-colors hover:text-[#5f2f8c]">Read article</Link>
            </article>
          ))}
        </div>
      </section>
      </div>
    </main>
  );
}